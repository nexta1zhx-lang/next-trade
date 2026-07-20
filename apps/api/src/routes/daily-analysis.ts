import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import ccxt from 'ccxt'
import {config} from '../config.js'
import {redis} from '../services/redis.js'
import type {DailyAnalysisItem, DailyAnalysisResult} from '@nexttrade/shared'

interface MarketMeta {
  id: string
  symbol: string
  base: string
  quote: string
  active: boolean
  swap: boolean
  linear: boolean
}

const router = new Hono()

// ─── 查询参数校验 ───
const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format YYYY-MM-DD')
    .refine(d => d < new Date().toISOString().slice(0, 10), {
      message: 'Cannot query today or future'
    }),
  minQuoteVolume: z.coerce.number().positive().default(1_000_000)
})

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
      } catch {
        // skip failed symbols silently
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

// ─── 主路由 ───
router.get('/', zValidator('query', querySchema), async c => {
  const {date, minQuoteVolume} = c.req.valid('query')

  // 1. 检查 Redis 缓存 (TTL 3600s)
  const cacheKey = `daily:${date}:${minQuoteVolume}`
  if (redis.status === 'ready') {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return c.json({
        success: true,
        data: JSON.parse(cached) as DailyAnalysisResult
      })
    }
  }

  // 2. 初始化 Binance USDT 永续合约交易所
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    timeout: 30000,
    options: {defaultType: 'future'}
  })

  // 加载代理模块（国内必需）
  if (config.HTTPS_PROXY) {
    // 方式1: process.env (CCXT 内部可能读取)
    process.env.HTTPS_PROXY = config.HTTPS_PROXY
    process.env.HTTP_PROXY = config.HTTPS_PROXY
    // 方式2: CCXT 原生代理
    await exchange.loadProxyModules()
    exchange.httpsProxy = config.HTTPS_PROXY
    console.log('✓ Proxy configured:', config.HTTPS_PROXY)
  }

  // 3. 加载市场并过滤 USDT 永续合约
  console.log('→ Loading markets, proxy:', exchange.httpsProxy)
  await exchange.loadMarkets()
  console.log('→ Markets loaded')
  const allMarkets = Object.values(exchange.markets) as MarketMeta[]
  const markets = allMarkets.filter(
    m => m.active && m.swap && m.linear && m.quote === 'USDT'
  )

  const totalSymbols = markets.length
  // 只取交易对 id（如 BTCUSDT），CCXT fetchOHLCV 需要 id
  const symbols = markets.map(m => m.id)

  // 4. 计算目标日期的时间戳范围 (UTC)
  const dateUtc = new Date(`${date}T00:00:00.000Z`)
  const since = dateUtc.getTime()

  // 5. 并发抓取 OHLCV (每批 10 个，间隔 50ms)
  const items: DailyAnalysisItem[] = []
  const ohlcvResults = await asyncPool(symbols, 10, async (id: string) => {
    // 加小延迟避免触发 rate limit
    await new Promise(r => setTimeout(r, 50))
    try {
      const ohlcv = await exchange.fetchOHLCV(id, '1d', since, 1)
      if (!ohlcv || ohlcv.length === 0) return null
      const candle = ohlcv[0]
      const open = candle[1] ?? 0
      const high = candle[2] ?? 0
      const low = candle[3] ?? 0
      const close = candle[4] ?? 0
      const volume = candle[5] ?? 0
      return {id, open, high, low, close, volume}
    } catch {
      return null
    }
  })

  // 6. 计算指标 & 过滤
  for (const raw of ohlcvResults) {
    if (!raw) continue
    const {id, open, high, low, close, volume} = raw
    if (open === 0) continue

    const amplitude = ((high - low) / open) * 100
    const change = ((close - open) / open) * 100
    const quoteVolume = close * volume
    const isDoji = amplitude > 10 && Math.abs(change) < 2

    if (quoteVolume < minQuoteVolume) continue

    // 查找原始 symbol（带 :USDT 后缀，如 BTC/USDT:USDT）
    const market = markets.find(m => m.id === id)
    const symbol = market?.symbol ?? `${id}/USDT:USDT`

    items.push({
      symbol,
      base: market?.base ?? id.replace('USDT', ''),
      open,
      high,
      low,
      close,
      amplitude: round(amplitude),
      change: round(change),
      quoteVolume: round(quoteVolume),
      isDoji
    })
  }

  // 7. 排序取 TOP 50
  const byAmplitude = [...items]
    .sort((a, b) => b.amplitude - a.amplitude)
    .slice(0, 50)
  const byGain = [...items].sort((a, b) => b.change - a.change).slice(0, 50)
  const byLoss = [...items].sort((a, b) => a.change - b.change).slice(0, 50)
  const dojis = items
    .filter(i => i.isDoji)
    .sort((a, b) => b.quoteVolume - a.quoteVolume)

  const result: DailyAnalysisResult = {
    date,
    cachedAt: Date.now(),
    totalSymbols,
    filteredCount: items.length,
    rankAmplitude: byAmplitude,
    rankGain: byGain,
    rankLoss: byLoss,
    rankDoji: dojis
  }

  // 8. 写 Redis 缓存
  if (redis.status === 'ready') {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600)
  }

  return c.json({success: true, data: result})
})

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export {router as dailyAnalysisRouter}
