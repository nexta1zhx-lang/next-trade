import {redis} from './redis.js'
import {db} from '../db/index.js'
import {watchlistSnapshots} from '../db/schema/watchlist.js'
import type {WatchlistItem} from '@nexttrade/shared'

const CACHE_TTL = 86400 // 24h

function cacheKey(date?: string): string {
  return date ? `market:watchlist:${date}` : 'market:watchlist:active'
}

interface SqueezeCandidate {
  symbol: string
  base: string
  high: number
  low: number
  close: number
  volume: number
  amplitude: number
  isSqueeze: boolean
  atr: number
}

interface VwapInput {
  high: number
  low: number
  close: number
  volume: number
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 计算 VWAP
 * VWAP = Σ(typical_price × volume) / Σ(volume)
 * typical_price = (high + low + close) / 3
 */
function calcVwap(candles: VwapInput[]): number {
  let cumTP = 0
  let cumVol = 0
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3
    cumTP += tp * c.volume
    cumVol += c.volume
  }
  return cumVol > 0 ? cumTP / cumVol : 0
}

/**
 * 为 TOP 10 标的计算完整点位并持久化
 */
export async function runOperatorEngine(
  items: SqueezeCandidate[],
  ohlcvMap: Map<string, VwapInput[]>,
  recordDate?: string,
): Promise<WatchlistItem[]> {
  const today = recordDate ?? new Date().toISOString().slice(0, 10)
  const results: WatchlistItem[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const candles = ohlcvMap.get(item.symbol) ?? []
    const {high, low, close} = item

    // VWAP
    const vwap = candles.length >= 20 ? r2(calcVwap(candles)) : close

    // Fibonacci 回调位
    const range = high - low
    const fib0382 = r2(low + range * 0.382)
    const fib0618 = r2(low + range * 0.618)

    const watchItem: WatchlistItem = {
      symbol: item.symbol,
      base: item.base,
      lastPrice: close,
      dayHigh: high,
      dayLow: low,
      vwap,
      fib0382,
      fib0618,
      isSqueeze: item.isSqueeze,
      atr: item.atr,
      amplitude: item.amplitude,
      quoteVolume: r2(item.volume),
      score: r2((i + 1) * 10), // 百分制评分
      updatedAt: Date.now()
    }

    results.push(watchItem)

    // 写入 PostgreSQL
    try {
      await db
        .insert(watchlistSnapshots)
        .values({
          symbol: item.symbol,
          recordDate: today,
          rank: String(i + 1),
          lastPrice: String(close),
          dayHigh: String(high),
          dayLow: String(low),
          vwap: String(vwap),
          fib0382: String(fib0382),
          fib0618: String(fib0618),
          atr: String(item.atr),
          amplitude: String(item.amplitude),
          quoteVolume: String(r2(item.volume)),
          isSqueeze: item.isSqueeze,
          score: String(watchItem.score)
        })
        .onConflictDoUpdate({
          target: [watchlistSnapshots.recordDate, watchlistSnapshots.symbol],
          set: {
            rank: String(i + 1),
            lastPrice: String(close),
            dayHigh: String(high),
            dayLow: String(low),
            vwap: String(vwap),
            fib0382: String(fib0382),
            fib0618: String(fib0618),
            atr: String(item.atr),
            amplitude: String(item.amplitude),
            quoteVolume: String(r2(item.volume)),
            isSqueeze: item.isSqueeze,
            score: String(watchItem.score)
          }
        })
    } catch (e) {
      console.error(
        `[operatorEngine] DB insert failed for ${item.symbol}:`,
        (e as Error).message
      )
    }
  }

  // 写入 Redis Hash
  if (redis.status === 'ready') {
    try {
      const key = cacheKey(today)
      const hashData: Record<string, string> = {}
      for (const r of results) {
        hashData[r.symbol] = JSON.stringify(r)
      }
      await redis.hset(key, hashData)
      await redis.expire(key, CACHE_TTL)
    } catch (e) {
      console.error('[operatorEngine] Redis write failed:', (e as Error).message)
    }
  }

  return results
}

/**
 * 从 Redis 读取当前活跃的 watchlist
 */
export async function getWatchlist(date?: string): Promise<WatchlistItem[]> {
  if (redis.status !== 'ready') return []

  try {
    const key = cacheKey(date)
    const raw = await redis.hgetall(key)
    if (!raw || Object.keys(raw).length === 0) return []

    return Object.values(raw)
      .map(v => JSON.parse(v as string) as WatchlistItem)
      .sort((a, b) => a.score - b.score)
  } catch {
    return []
  }
}
