import ccxt from 'ccxt'
import {eq, and} from 'drizzle-orm'
import {config} from '../config.js'
import {redis} from './redis.js'
import {db} from '../db/index.js'
import {contractVolatilityRank} from '../db/schema/volatility.js'
import type {VolatilityItem, VolatilityRankResult} from '@nexttrade/shared'

// ─── 常量 ───
const VOLATILITY_TOP_N = 20
const MIN_QUOTE_VOLUME = 1_000_000 // 1M USDT
const CACHE_TTL = 3600 // 1h

// ─── Binance 市场元信息 ───
interface MarketMeta {
  id: string
  symbol: string
  base: string
  quote: string
  active: boolean
  swap: boolean
  linear: boolean
}

// ─── 工具: 保留两位小数 ───
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── 工具: 安全转数字 ───
function num(v: number | undefined | null, fallback = 0): number {
  return v ?? fallback
}

/**
 * 同步指定交易所的合约震荡榜
 * 流程: fetchMarkets → fetchTickers → 计算 → 过滤 → 排序 → 落 DB → 写缓存
 */
export async function syncVolatilityRank(
  exchangeId: 'binance'
): Promise<VolatilityRankResult> {
  const today = new Date().toISOString().slice(0, 10)

  // 1. 初始化交易所
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    timeout: 30000,
    options: {defaultType: 'future'}
  })

  if (config.HTTPS_PROXY) {
    await exchange.loadProxyModules()
    exchange.httpsProxy = config.HTTPS_PROXY
  }

  // 2. 加载市场 → 过滤 USDT 永续合约
  await exchange.loadMarkets()
  const allMarkets = Object.values(exchange.markets) as MarketMeta[]
  const markets = allMarkets.filter(
    m => m.active && m.swap && m.linear && m.quote === 'USDT'
  )
  const symbolToMarket = new Map(markets.map(m => [m.id, m]))

  // 3. fetchTickers() — 一次获取所有 24h ticker
  const tickers = await exchange.fetchTickers()
  if (!tickers) throw new Error('fetchTickers returned null')

  // 4. 计算指标 + 过滤
  const items: VolatilityItem[] = []

  for (const [id, t] of Object.entries(tickers)) {
    const market = symbolToMarket.get(id)
    if (!market) continue // 不是 USDT 永续，跳过

    const high = num(t.high)
    const low = num(t.low)
    const open = num(t.open)
    const close = num(t.last ?? t.close)
    const baseVolume = num(t.baseVolume)
    const quoteVolume = close * baseVolume

    // 过滤低流动性
    if (quoteVolume < MIN_QUOTE_VOLUME) continue
    if (low === 0 || open === 0) continue

    // 振幅计算
    const amplitude = ((high - low) / low) * 100
    const bodyRange = (Math.abs(close - open) / low) * 100
    const upperWick = ((high - Math.max(open, close)) / low) * 100
    const lowerWick = ((Math.min(open, close) - low) / low) * 100
    const change = ((close - open) / open) * 100

    items.push({
      symbol: market.symbol,
      base: market.base,
      open: r2(open),
      high: r2(high),
      low: r2(low),
      close: r2(close),
      amplitude: r2(amplitude),
      bodyRange: r2(bodyRange),
      upperWick: r2(upperWick),
      lowerWick: r2(lowerWick),
      change: r2(change),
      quoteVolume: r2(quoteVolume),
      rank: 0 // 排序后填充
    })
  }

  // 5. 按振幅降序排序 → TOP N
  items.sort((a, b) => b.amplitude - a.amplitude)
  const top = items.slice(0, VOLATILITY_TOP_N).map((item, i) => ({
    ...item,
    rank: i + 1
  }))

  // 6. 写入 PostgreSQL (UPSERT)
  for (const item of top) {
    await db
      .insert(contractVolatilityRank)
      .values({
        date: today,
        exchange: exchangeId,
        symbol: item.symbol,
        base: item.base,
        rank: item.rank,
        open: String(item.open),
        high: String(item.high),
        low: String(item.low),
        close: String(item.close),
        amplitude: String(item.amplitude),
        body_range: String(item.bodyRange),
        upper_wick: String(item.upperWick),
        lower_wick: String(item.lowerWick),
        change: String(item.change),
        quote_volume: String(item.quoteVolume)
      })
      .onConflictDoUpdate({
        target: [
          contractVolatilityRank.date,
          contractVolatilityRank.exchange,
          contractVolatilityRank.symbol
        ],
        set: {
          rank: item.rank,
          open: String(item.open),
          high: String(item.high),
          low: String(item.low),
          close: String(item.close),
          amplitude: String(item.amplitude),
          body_range: String(item.bodyRange),
          upper_wick: String(item.upperWick),
          lower_wick: String(item.lowerWick),
          change: String(item.change),
          quote_volume: String(item.quoteVolume),
          updatedAt: new Date()
        }
      })
  }

  // 7. 写入 Redis 缓存
  const result: VolatilityRankResult = {
    exchange: exchangeId,
    date: today,
    updatedAt: Date.now(),
    top
  }

  if (redis.status === 'ready') {
    const cacheKey = `market:volatility:top20:${exchangeId}:${today}`
    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL)
  }

  return result
}

/**
 * 查询震荡榜（缓存 → DB → 空）
 */
export async function queryVolatilityRank(
  exchangeId: string,
  date: string
): Promise<VolatilityRankResult | null> {
  // 1. 查 Redis
  const cacheKey = `market:volatility:top20:${exchangeId}:${date}`
  if (redis.status === 'ready') {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as VolatilityRankResult
  }

  // 2. 查 PostgreSQL
  const rows = await db
    .select()
    .from(contractVolatilityRank)
    .where(
      and(
        eq(contractVolatilityRank.date, date),
        eq(contractVolatilityRank.exchange, exchangeId)
      )
    )
    .orderBy(contractVolatilityRank.rank)
    .limit(VOLATILITY_TOP_N)

  if (rows.length === 0) return null

  const top: VolatilityItem[] = rows.map(r => ({
    symbol: r.symbol,
    base: r.base,
    rank: r.rank,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    amplitude: Number(r.amplitude),
    bodyRange: Number(r.body_range),
    upperWick: Number(r.upper_wick),
    lowerWick: Number(r.lower_wick),
    change: Number(r.change),
    quoteVolume: Number(r.quote_volume)
  }))

  const result: VolatilityRankResult = {
    exchange: exchangeId,
    date,
    updatedAt: Date.now(),
    top
  }

  // 写回 Redis（加速下次查询）
  if (redis.status === 'ready') {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL)
  }

  return result
}
