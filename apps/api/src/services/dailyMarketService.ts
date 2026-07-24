import {db} from '../db/index.js'
import {dailyMarketData} from '../db/schema.js'
import {redis} from './redis.js'
import {getBinanceFuture} from './exchange.js'
import type ccxt from 'ccxt'

interface MarketMeta {
  id: string
  symbol: string
  base: string
  quote: string
  active: boolean
  swap: boolean
  linear: boolean
}

interface RawOHLCV {
  id: string
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

// ─── 并发控制器 ───
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
      } catch (err) {
        console.warn(`[asyncPool] 未知错误:`, (err as Error).message)
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

function round(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── 带重试的单个币种 OHLCV 抓取 ───
async function fetchSingleOHLCVWithRetry(
  exchange: InstanceType<typeof ccxt.binance>,
  id: string,
  markets: MarketMeta[],
  since: number,
  retries = 3
): Promise<RawOHLCV | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise(r => setTimeout(r, 100 + Math.random() * 50))
      const ohlcv = await exchange.fetchOHLCV(id, '1d', since, 1)
      if (!ohlcv || ohlcv.length === 0) return null
      const candle = ohlcv[0]
      const market = markets.find(m => m.id === id)
      return {
        id,
        symbol: market?.symbol ?? `${id}/USDT:USDT`,
        base: market?.base ?? id.replace('USDT', ''),
        open: candle[1] ?? 0,
        high: candle[2] ?? 0,
        low: candle[3] ?? 0,
        close: candle[4] ?? 0,
        volume: candle[5] ?? 0
      } as RawOHLCV
    } catch (err) {
      const isLast = attempt === retries
      if (isLast) {
        console.warn(
          `[DailyMarket] ${id} 抓取失败 (${retries}次重试后放弃):`,
          (err as Error).message
        )
        return null
      }
      // 指数退避：1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000
      console.warn(
        `[DailyMarket] ${id} 第${attempt}次失败，${delay}ms后重试:`,
        (err as Error).message
      )
      await new Promise(r => setTimeout(r, delay))
    }
  }
  return null
}

// ─── 从 Binance 抓取全量日线数据 ───
async function fetchAllDailyOHLCV(date: string): Promise<ComputedMarket[]> {
  const exchange = await getBinanceFuture()
  const allMarkets = Object.values(exchange.markets) as MarketMeta[]
  const markets = allMarkets.filter(
    m => m.active && m.swap && m.linear && m.quote === 'USDT'
  )

  const symbols = markets.map(m => m.id)
  const dateUtc = new Date(`${date}T00:00:00.000Z`)
  const since = dateUtc.getTime()

  // 第一轮：并发抓取（带重试）
  const ohlcvResults = await asyncPool(symbols, 10, async (id: string) => {
    return fetchSingleOHLCVWithRetry(exchange, id, markets, since, 3)
  })

  // 统计失败数量
  const failedSymbols = symbols.filter((_, i) => !ohlcvResults[i])
  if (failedSymbols.length > 0) {
    console.warn(
      `[DailyMarket] 首轮抓取完成，${failedSymbols.length}/${symbols.length} 个币种失败`,
      failedSymbols.slice(0, 20).join(', ') +
        (failedSymbols.length > 20 ? `... (共${failedSymbols.length}个)` : '')
    )

    // 第二轮：对失败的币种逐个低速重试
    console.log(
      `[DailyMarket] 开始第二轮低速重试 ${failedSymbols.length} 个...`
    )
    for (const id of failedSymbols) {
      await new Promise(r => setTimeout(r, 500))
      const retried = await fetchSingleOHLCVWithRetry(
        exchange,
        id,
        markets,
        since,
        2
      )
      if (retried) {
        const idx = symbols.indexOf(id)
        ohlcvResults[idx] = retried
      }
    }
  }

  // 计算指标（不含排名）
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
  const byAmplitude = [...computed].sort((a, b) => b.amplitude - a.amplitude)
  const byGain = [...computed].sort((a, b) => b.change - a.change)
  const byLoss = [...computed].sort((a, b) => a.change - b.change)

  return computed.map(item => ({
    ...item,
    rankAmplitude: byAmplitude.findIndex(x => x.id === item.id) + 1,
    rankGain: byGain.findIndex(x => x.id === item.id) + 1,
    rankLoss: byLoss.findIndex(x => x.id === item.id) + 1
  }))
}

// ─── 批量写入 daily_market_data (UPSERT) ───
async function upsertBatch(items: ComputedMarket[], dateStr: string) {
  if (items.length === 0) return 0

  // 分批写入，每批 50 条
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

    // 逐条 upsert（Drizzle ORM 不支持高效 bulk upsert）
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

// ─── 公开：定时采集 & 存储 ───
export async function collectAndStore(): Promise<{
  date: string
  count: number
}> {
  // 采集昨天 UTC 的数据（当天日线可能未收盘）
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  const dateStr = d.toISOString().slice(0, 10)

  console.log(`[DailyMarket] 开始采集 ${dateStr} 的行情数据...`)
  const data = await fetchAllDailyOHLCV(dateStr)
  console.log(`[DailyMarket] 采集完成，共 ${data.length} 条`)

  const count = await upsertBatch(data, dateStr)
  console.log(`[DailyMarket] 写入完成，共 ${count} 条`)

  // 刷新 Redis 缓存
  if (redis.status === 'ready') {
    // 删除所有 minQuoteVolume 变体的缓存
    const keys = await redis.keys(`daily:${dateStr}:*`)
    if (keys.length > 0) {
      await redis.del(keys)
      console.log(`[DailyMarket] 清除 ${keys.length} 个 Redis 缓存`)
    }
  }

  return {date: dateStr, count}
}

// ─── 公开：从 DB + Redis 读取（供路由使用）───
export {fetchAllDailyOHLCV, round, asyncPool, upsertBatch}
