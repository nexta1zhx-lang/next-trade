/**
 * 每日行情采集服务 — 原生 HTTP 版
 *
 * 直接 fetch Binance USDⓈ-M Futures REST API，内置令牌桶速率限制，
 * 单轮并发抓取全量 USDT 永续合约日线 OHLCV。
 *
 * Binance 限制: 2400 req/min (IP)
 * 我们的策略: 30 req/s 令牌桶 = 1800/min，留足余量
 */

import {db} from '../db/index.js'
import {dailyMarketData} from '../db/schema.js'
import {redis} from './redis.js'

// ─── 常量 ───

const FAPI_BASE = 'https://fapi.binance.com'
const RATE_LIMIT = 30 // 每秒最多请求数
const CONCURRENCY = 10 // 并发 worker 数
const REQ_DELAY_MS = 50 // 每个请求前等待 ms

interface RawOHLCV {
  symbol: string
  base: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface ComputedMarket extends RawOHLCV {
  amplitude: number
  change: number
  quoteVolume: number
  isDoji: boolean
  rankAmplitude: number
  rankGain: number
  rankLoss: number
}

// ─── 令牌桶限流器 ───

class TokenBucket {
  private tokens: number
  private lastRefill: number
  private maxTokens: number

  constructor(rate: number) {
    this.tokens = rate
    this.maxTokens = rate
    this.lastRefill = Date.now()
  }

  async wait(): Promise<void> {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * RATE_LIMIT)
    this.lastRefill = now

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // 需要等待的时间 (秒)
    const waitTime = ((1 - this.tokens) / RATE_LIMIT) * 1000 + 10
    await new Promise(r => setTimeout(r, waitTime))
    this.tokens = 0
    this.lastRefill = Date.now()
  }
}

const bucket = new TokenBucket(RATE_LIMIT)

// ─── 原生 fetch 封装 ───

async function binanceGet(path: string): Promise<any> {
  await bucket.wait()
  const res = await fetch(`${FAPI_BASE}${path}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ─── 交易对缓存 ───

let cachedSymbols: Array<{symbol: string; base: string}> | null = null

async function getUsdtSwapSymbols(): Promise<
  Array<{symbol: string; base: string}>
> {
  if (cachedSymbols) return cachedSymbols

  const data = await binanceGet('/fapi/v1/exchangeInfo')
  cachedSymbols = (data.symbols ?? [])
    .filter(
      (s: any) =>
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING'
    )
    .map((s: any) => ({symbol: s.symbol, base: s.baseAsset}))

  console.log(`[DailyMarket] USDT永续合约: ${cachedSymbols.length} 个`)
  return cachedSymbols
}

function resetSymbolCache() {
  cachedSymbols = null
}

// ─── 工具 ───

function round(n: number): number {
  return Math.round(n * 100) / 100
}

async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  const queue = [...items]

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift()!
      const idx = items.indexOf(item)
      try {
        results[idx] = await fn(item)
      } catch {
        // 静默跳过失败
      }
    }
  }

  const workers = Array.from(
    {length: Math.min(concurrency, items.length)},
    () => worker()
  )
  await Promise.all(workers)
  return results.filter(Boolean)
}

// ─── 全量日线采集 ───

async function fetchAllDailyOHLCV(date: string): Promise<ComputedMarket[]> {
  const symbols = await getUsdtSwapSymbols()
  const dateUtc = new Date(`${date}T00:00:00.000Z`)
  const since = dateUtc.getTime()

  console.log(
    `[DailyMarket] 开始采集 ${date}，共 ${symbols.length} 个币种，并发=${CONCURRENCY}，限速=${RATE_LIMIT}/s`
  )

  const ohlcvResults = await asyncPool(
    symbols,
    CONCURRENCY,
    async ({symbol, base}) => {
      await new Promise(r => setTimeout(r, REQ_DELAY_MS))
      try {
        const data = await binanceGet(
          `/fapi/v1/klines?symbol=${symbol}&interval=1d&startTime=${since}&limit=1`
        )
        if (!Array.isArray(data) || data.length === 0) return null
        const c = data[0]
        return {
          symbol,
          base,
          open: Number(c[1]) ?? 0,
          high: Number(c[2]) ?? 0,
          low: Number(c[3]) ?? 0,
          close: Number(c[4]) ?? 0,
          volume: Number(c[5]) ?? 0
        } as RawOHLCV
      } catch {
        return null
      }
    }
  )

  const successful = ohlcvResults.length
  console.log(
    `[DailyMarket] 采集完成: ${successful}/${symbols.length} 个币种成功`
  )

  // 计算指标
  const computed: Omit<
    ComputedMarket,
    'rankAmplitude' | 'rankGain' | 'rankLoss'
  >[] = []
  for (const raw of ohlcvResults) {
    if (!raw || raw.open === 0) continue

    const amplitude = ((raw.high - raw.low) / raw.open) * 100
    const change = ((raw.close - raw.open) / raw.open) * 100
    const quoteVolume = raw.close * raw.volume
    const isDoji = amplitude > 10 && Math.abs(change) < 2

    computed.push({
      ...raw,
      amplitude: round(amplitude),
      change: round(change),
      quoteVolume: round(quoteVolume),
      isDoji
    })
  }

  // 计算排名
  const byAmplitude = [...computed].sort(
    (a, b) => b.amplitude - a.amplitude
  )
  const byGain = [...computed].sort((a, b) => b.change - a.change)
  const byLoss = [...computed].sort((a, b) => a.change - b.change)

  return computed.map(item => ({
    ...item,
    rankAmplitude: byAmplitude.findIndex(x => x.symbol === item.symbol) + 1,
    rankGain: byGain.findIndex(x => x.symbol === item.symbol) + 1,
    rankLoss: byLoss.findIndex(x => x.symbol === item.symbol) + 1
  }))
}

// ─── 批量写入 (UPSERT) ───

async function upsertBatch(items: ComputedMarket[], dateStr: string) {
  if (items.length === 0) return 0

  const BATCH_SIZE = 50
  let inserted = 0

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const values = batch.map(item => ({
      date: dateStr,
      exchange: 'binance',
      symbol: item.symbol,
      base: item.base,
      open: String(item.open),
      high: String(item.high),
      low: String(item.low),
      close: String(item.close),
      amplitude: String(item.amplitude),
      change: String(item.change),
      quoteVolume: String(item.quoteVolume),
      isDoji: item.isDoji,
      rankAmplitude: item.rankAmplitude,
      rankGain: item.rankGain,
      rankLoss: item.rankLoss,
      updatedAt: new Date()
    }))

    for (const row of values) {
      await db
        .insert(dailyMarketData)
        .values(row)
        .onConflictDoUpdate({
          target: [
            dailyMarketData.date,
            dailyMarketData.exchange,
            dailyMarketData.symbol
          ],
          set: {
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            amplitude: row.amplitude,
            change: row.change,
            quoteVolume: row.quoteVolume,
            isDoji: row.isDoji,
            rankAmplitude: row.rankAmplitude,
            rankGain: row.rankGain,
            rankLoss: row.rankLoss,
            updatedAt: row.updatedAt
          }
        })
    }
    inserted += batch.length
  }

  return inserted
}

async function clearRedisCache(dateStr: string) {
  if (redis.status !== 'ready') return
  try {
    const keys = await redis.keys(`daily:${dateStr}:*`)
    if (keys.length > 0) await redis.del(keys)
  } catch {}
}

// ─── 采集锁 ───

let collecting = false
let collectingDate = ''

// ─── 公开 API ───

/** 定时采集昨天数据 (cron) */
export async function collectAndStore(): Promise<{
  date: string
  count: number
}> {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  const dateStr = d.toISOString().slice(0, 10)

  resetSymbolCache()
  console.log(`[DailyMarket] 定时采集 ${dateStr}`)
  const data = await fetchAllDailyOHLCV(dateStr)
  const count = await upsertBatch(data, dateStr)
  await clearRedisCache(dateStr)
  console.log(`[DailyMarket] 定时采集完成: ${count} 条`)
  return {date: dateStr, count}
}

/** 按需采集指定日期 */
export async function collectDate(dateStr: string): Promise<{
  date: string
  count: number
}> {
  // 内存锁防并发
  if (collecting && collectingDate === dateStr) {
    console.log(`[DailyMarket] ${dateStr} 采集中，等待...`)
    for (let i = 0; i < 120 && collecting; i++) {
      await new Promise(r => setTimeout(r, 1000))
    }
    return {date: dateStr, count: 0}
  }
  collecting = true
  collectingDate = dateStr

  try {
    resetSymbolCache()
    const data = await fetchAllDailyOHLCV(dateStr)
    const count = await upsertBatch(data, dateStr)
    await clearRedisCache(dateStr)
    console.log(`[DailyMarket] ${dateStr} 采集完成: ${count} 条`)
    return {date: dateStr, count}
  } finally {
    collecting = false
    collectingDate = ''
  }
}

export {fetchAllDailyOHLCV, round, asyncPool, upsertBatch}
