import {redis} from './redis.js'
import {getConfig} from './configService.js'
import type {AlertType, PriceAlert} from '@nexttrade/shared'

const ALERT_CHANNEL = 'channel:market_alerts'

interface LevelSet {
  symbol: string
  base: string
  dayHigh: number
  dayLow: number
  vwap: number
  fib0382: number
  fib0618: number
  isSqueeze: boolean
}

interface Kline {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface KlineState {
  buffer: Kline[] // 最多 20 根
  current: Kline | null // 当前未闭合
}

class CollisionEngine {
  // 警戒点位
  private levels = new Map<string, LevelSet>()
  // 最新价格
  private prices = new Map<string, number>()
  // K 线缓存 (用于 volume SMA)
  private klines = new Map<string, KlineState>()
  // Cooldown 记录: key = `${symbol}:${type}`
  private cooldowns = new Map<string, number>()
  // 配置缓存（每 5min 刷新）
  private cfg: {
    cooldownMs: number
    volumeSpikeThreshold: number
    volumeShrinkThreshold: number
    priceProximityPct: number
  } | null = null
  private lastCfgFetch = 0

  private async getCfg() {
    const now = Date.now()
    if (!this.cfg || now - this.lastCfgFetch > 300_000) {
      const full = await getConfig()
      this.cfg = {
        cooldownMs: full.cooldownMs,
        volumeSpikeThreshold: full.volumeSpikeThreshold,
        volumeShrinkThreshold: full.volumeShrinkThreshold,
        priceProximityPct: full.priceProximityPct
      }
      this.lastCfgFetch = now
    }
    return this.cfg
  }

  /**
   * 更新警戒点位（由 wsManager 调用）
   */
  updateLevels(items: LevelSet[]): void {
    this.levels.clear()
    for (const item of items) {
      this.levels.set(toKey(item.symbol), item)
    }
    console.log(`[collision] Levels updated: ${items.length} symbols`)
  }

  /**
   * 处理 bookTicker（实时价格）
   */
  onBookTicker(symbol: string, price: number): void {
    this.prices.set(symbol, price)
    // 异步触发碰撞检测，不阻塞 WS 消息处理
    this.checkBreakout(symbol, price)
    this.checkSupport(symbol, price)
  }

  /**
   * 处理 K 线闭合事件
   */
  onKlineClosed(symbol: string, kline: Kline, isClosed: boolean): void {
    let state = this.klines.get(symbol)
    if (!state) {
      state = {buffer: [], current: null}
      this.klines.set(symbol, state)
    }

    if (isClosed) {
      // 闭合 K 线加入 buffer
      state.buffer.push(kline)
      if (state.buffer.length > 20) state.buffer.shift()
      state.current = null

      // 挤压释放检测
      this.checkSqueezeRelease(symbol, kline)
    } else {
      state.current = kline
    }
  }

  /**
   * 突破告警: price > dayHigh 且 1m 量能为均量 N 倍
   */
  private async checkBreakout(symbol: string, price: number): Promise<void> {
    const level = this.levels.get(symbol)
    if (!level) return
    const cfg = await this.getCfg()

    if (price <= level.dayHigh) return

    const volOk = await this.isVolumeSpike(symbol, cfg.volumeSpikeThreshold)
    if (!volOk) return

    this.fireAlert(
      symbol,
      level,
      'breakout',
      price,
      `${level.base} 突破日内高点 $${level.dayHigh} → $${price.toFixed(2)}，放量 ${cfg.volumeSpikeThreshold}倍`,
      'danger'
    )
  }

  /**
   * 支撑告警: 价格接近 VWAP/Fib382 且缩量且下影线
   */
  private async checkSupport(symbol: string, price: number): Promise<void> {
    const level = this.levels.get(symbol)
    if (!level) return
    const cfg = await this.getCfg()

    const nearVwap = this.isNear(price, level.vwap, cfg.priceProximityPct)
    const nearFib382 = this.isNear(price, level.fib0382, cfg.priceProximityPct)

    if (!nearVwap && !nearFib382) return

    const volOk = await this.isVolumeShrink(symbol, cfg.volumeShrinkThreshold)
    if (!volOk) return

    const hasLowerWick = this.hasLowerWick(symbol)
    if (!hasLowerWick) return

    const label = nearVwap ? 'VWAP' : 'Fib 0.382'
    this.fireAlert(
      symbol,
      level,
      'support',
      price,
      `${level.base} 回调至 ${label} $${price.toFixed(2)}，缩量下影线支撑`,
      'warning'
    )
  }

  /**
   * 挤压释放: Squeeze 状态 + K 线闭合突破 BB
   */
  private checkSqueezeRelease(symbol: string, kline: Kline): void {
    const level = this.levels.get(symbol)
    if (!level || !level.isSqueeze) return

    // 简化检测: 闭合 K 线振幅 > ATR 则认为突破
    // 实际生产中可计算 BB 上下轨
    const range = kline.high - kline.low
    const prevKlines = this.klines.get(symbol)?.buffer ?? []
    if (prevKlines.length < 5) return

    // 用最近 5 根的平均振幅作为基准
    const avgRange =
      prevKlines.slice(-5).reduce((s, k) => s + (k.high - k.low), 0) / 5

    if (range <= avgRange * 1.5) return

    const direction = kline.close > kline.open ? '向上' : '向下'
    this.fireAlert(
      symbol,
      level,
      'squeeze_release',
      kline.close,
      `${level.base} Squeeze 释放 ${direction}！振幅 ${((range / kline.open) * 100).toFixed(2)}%`,
      'danger'
    )
  }

  private isVolumeSpike(symbol: string, threshold: number): boolean {
    const state = this.klines.get(symbol)
    if (!state || state.buffer.length < 5) return false
    const recent = state.buffer.slice(-5)
    const avg = recent.reduce((s, k) => s + k.volume, 0) / recent.length
    if (avg === 0) return false
    const current = state.current
    if (!current) return false
    return current.volume > avg * threshold
  }

  private async isVolumeShrink(
    symbol: string,
    threshold: number
  ): Promise<boolean> {
    const kline = this.klines.get(symbol)?.current
    const buffer = this.klines.get(symbol)?.buffer ?? []
    if (!kline || buffer.length < 5) return false
    const avg = buffer.slice(-5).reduce((s, k) => s + k.volume, 0) / 5
    if (avg === 0) return false
    return kline.volume < avg * threshold
  }

  /**
   * 判断当前 K 线是否有下影线
   */
  private hasLowerWick(symbol: string): boolean {
    const kline = this.klines.get(symbol)?.current
    if (!kline) return false

    const body = Math.abs(kline.close - kline.open)
    const lowerWick =
      kline.low < Math.min(kline.open, kline.close)
        ? Math.min(kline.open, kline.close) - kline.low
        : 0

    return lowerWick > body * 0.5 // 下影线至少为实体的 50%
  }

  /**
   * 价格接近检测
   */
  private isNear(price: number, target: number, pct: number): boolean {
    if (target === 0) return false
    return Math.abs(price - target) / target <= pct
  }

  private async fireAlert(
    symbol: string,
    level: LevelSet,
    type: AlertType,
    price: number,
    message: string,
    severity: 'info' | 'warning' | 'danger'
  ): Promise<void> {
    const cfg = await this.getCfg()
    const cooldownKey = `${symbol}:${type}`
    const last = this.cooldowns.get(cooldownKey)
    const now = Date.now()

    if (last && now - last < cfg.cooldownMs) return

    // 更新冷却
    this.cooldowns.set(cooldownKey, now)

    const alert: PriceAlert = {
      id: `${type}_${symbol}_${now}`,
      type,
      symbol: level.symbol,
      base: level.base,
      price,
      message,
      severity,
      timestamp: now
    }

    // 发布到 Redis Channel
    this.publish(alert)
  }

  /**
   * 发布告警到 Redis
   */
  private async publish(alert: PriceAlert): Promise<void> {
    if (redis.status !== 'ready') {
      console.log('[collision] ALERT:', alert.message)
      return
    }

    try {
      await redis.publish(ALERT_CHANNEL, JSON.stringify(alert))
      console.log(
        `[collision] 🔔 ${alert.severity === 'danger' ? '🔴' : '🟡'} ${alert.message}`
      )
    } catch (err) {
      console.error('[collision] Publish error:', (err as Error).message)
    }
  }
}

function toKey(symbol: string): string {
  return symbol.replace('/', '').split(':')[0].toLowerCase()
}

export const collisionEngine = new CollisionEngine()
