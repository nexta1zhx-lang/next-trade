import WebSocket from 'ws'
import {redis} from './redis.js'
import {collisionEngine} from './collisionEngine.js'

// ─── 常量 ───
const BINANCE_WS_URL = 'wss://fstream.binance.com/ws'
const WATCHLIST_KEY = 'market:watchlist:active'
const POLL_INTERVAL = 5 * 60 * 1000 // 5min
const RECONNECT_DELAY = 3000 // 3s
const PING_INTERVAL = 3 * 60 * 1000 // 3min

interface WatchlistSymbol {
  symbol: string // "BTC/USDT:USDT"
  base: string
  dayHigh: number
  dayLow: number
  vwap: number
  fib0382: number
  fib0618: number
  isSqueeze: boolean
}

/**
 * 币安流名称转换
 * "BTC/USDT:USDT" → "btcusdt"（小写，无分隔符）
 */
function toStreamId(symbol: string): string {
  return symbol.replace('/', '').split(':')[0].toLowerCase()
}

/**
 * WebSocket 管理器
 * - 读取 Redis watchlist 并维护币安 WS 连接
 * - 动态增减订阅标的
 * - 断线重连 + 心跳
 */
class WSManager {
  private ws: WebSocket | null = null
  private currentSymbols: string[] = []
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private isConnecting = false
  private shouldReconnect = true

  /**
   * 启动: 轮询 + 首次连接
   */
  async start(): Promise<void> {
    // 立即读取一次
    await this.pollAndConnect()

    // 每 5min 轮询 Redis
    this.pollTimer = setInterval(() => this.pollAndConnect(), POLL_INTERVAL)
    console.log('[wsManager] Started, polling every 5min')
  }

  /**
   * 停止: 清理所有定时器和连接
   */
  stop(): void {
    this.shouldReconnect = false
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
    console.log('[wsManager] Stopped')
  }

  /**
   * 读取 Redis → diff → 重建连接
   */
  private async pollAndConnect(): Promise<void> {
    try {
      const raw = await redis.hgetall(WATCHLIST_KEY)
      if (!raw || Object.keys(raw).length === 0) {
        console.log('[wsManager] Watchlist empty, skipping')
        return
      }

      const items: WatchlistSymbol[] = Object.values(raw).map(v =>
        JSON.parse(v as string)
      )
      const newSymbols = items.map(i => toStreamId(i.symbol))

      // 检查是否有变化
      const changed =
        newSymbols.length !== this.currentSymbols.length ||
        newSymbols.some(s => !this.currentSymbols.includes(s)) ||
        this.currentSymbols.some(s => !newSymbols.includes(s))

      if (!changed) return

      this.currentSymbols = newSymbols
      console.log(`[wsManager] Watchlist changed: ${newSymbols.length} symbols`)

      // 传递点位信息给碰撞引擎
      collisionEngine.updateLevels(items)

      // 重建 WS 连接
      this.connect()
    } catch (err) {
      console.error('[wsManager] Poll error:', (err as Error).message)
    }
  }

  /**
   * 建立币安 WS 连接
   */
  private connect(): void {
    if (this.isConnecting) return
    this.isConnecting = true

    // 关闭旧连接
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
    if (this.pingTimer) clearInterval(this.pingTimer)

    const streams = this.currentSymbols.flatMap(s => [
      `${s}@kline_1m`,
      `${s}@bookTicker`
    ])

    if (streams.length === 0) {
      this.isConnecting = false
      return
    }

    // 组合流: /stream?streams=btcusdt@kline_1m/btcusdt@bookTicker/...
    const url = `${BINANCE_WS_URL}/${streams.join('/')}`
    console.log(
      `[wsManager] Connecting... (${this.currentSymbols.length} symbols)`
    )

    try {
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        this.isConnecting = false
        console.log('[wsManager] Connected')

        // 心跳: 每 3min 发 PONG
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.pong()
          }
        }, PING_INTERVAL)
      })

      this.ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString())
          this.handleMessage(msg)
        } catch {
          // ignore parse errors
        }
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log(
          `[wsManager] Closed (${code}: ${reason?.toString() || 'unknown'})`
        )
        this.isConnecting = false
        if (this.shouldReconnect) {
          setTimeout(() => this.connect(), RECONNECT_DELAY)
        }
      })

      this.ws.on('error', (err: Error) => {
        console.error(`[wsManager] Error: ${err.message}`)
        this.isConnecting = false
      })
    } catch (err) {
      console.error('[wsManager] Connect error:', (err as Error).message)
      this.isConnecting = false
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), RECONNECT_DELAY)
      }
    }
  }

  /**
   * 处理 WS 消息，转发给碰撞引擎
   */
  private handleMessage(msg: Record<string, unknown>): void {
    // bookTicker
    if ((msg as any).u && (msg as any).s) {
      const data = msg as any
      collisionEngine.onBookTicker(data.s.toLowerCase(), parseFloat(data.c))
    }

    // kline_1m
    if ((msg as any).e === 'kline' && (msg as any).k) {
      const k = (msg as any).k
      collisionEngine.onKlineClosed(
        k.s.toLowerCase(),
        {
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v)
        },
        k.x === true // 是否闭合
      )
    }
  }
}

export const wsManager = new WSManager()
