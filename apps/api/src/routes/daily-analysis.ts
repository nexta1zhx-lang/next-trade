import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {dailyMarketData} from '../db/schema.js'
import {redis} from '../services/redis.js'
import {
  fetchAllDailyOHLCV,
  round,
  upsertBatch
} from '../services/dailyMarketService.js'
import type {DailyAnalysisItem, DailyAnalysisResult} from '@nexttrade/shared'
import {desc, asc, eq, and} from 'drizzle-orm'

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

// ─── 从 DB 查询并组装结果 ───
function buildResultFromRows(
  date: string,
  rows: (typeof dailyMarketData.$inferSelect)[],
  minQuoteVolume: number
): DailyAnalysisResult {
  const items: DailyAnalysisItem[] = rows.map(r => ({
    symbol: r.symbol,
    base: r.base,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    amplitude: Number(r.amplitude),
    change: Number(r.change),
    quoteVolume: Number(r.quoteVolume),
    isDoji: r.isDoji ?? false
  }))

  // 按交易量过滤
  const filtered =
    minQuoteVolume > 0
      ? items.filter(i => i.quoteVolume >= minQuoteVolume)
      : items

  const byAmplitude = [...filtered]
    .sort((a, b) => b.amplitude - a.amplitude)
    .slice(0, 50)
  const byGain = [...items].sort((a, b) => b.change - a.change).slice(0, 50)
  const byLoss = [...items].sort((a, b) => a.change - b.change).slice(0, 50)
  const dojis = items
    .filter(i => i.isDoji)
    .sort((a, b) => b.quoteVolume - a.quoteVolume)

  return {
    date,
    cachedAt: Date.now(),
    totalSymbols: rows.length,
    filteredCount: filtered.length,
    allItems: filtered,
    rankAmplitude: byAmplitude,
    rankGain: [...filtered].sort((a, b) => b.change - a.change).slice(0, 50),
    rankLoss: [...filtered].sort((a, b) => a.change - b.change).slice(0, 50),
    rankDoji: filtered
      .filter(i => i.isDoji)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
  }
}

// ─── 主路由 ───
router.get('/', zValidator('query', querySchema), async c => {
  const {date, minQuoteVolume} = c.req.valid('query')
  const cacheKey = `daily:${date}:${minQuoteVolume}`

  // 1. Redis 缓存命中 → 直接返回
  if (redis.status === 'ready') {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return c.json({
        success: true,
        data: JSON.parse(cached) as DailyAnalysisResult
      })
    }
  }

  // 2. 尝试从 DB 读取
  try {
    const rows = await db
      .select()
      .from(dailyMarketData)
      .where(
        and(
          eq(dailyMarketData.date, date),
          eq(dailyMarketData.exchange, 'binance')
        )
      )

    if (rows.length > 0) {
      const result = buildResultFromRows(date, rows, minQuoteVolume)
      // 写 Redis 缓存
      if (redis.status === 'ready') {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600)
      }
      return c.json({success: true, data: result})
    }
  } catch (err) {
    console.error(
      '[daily-analysis] DB query failed, falling back to live:',
      err
    )
  }

  // 3. DB 无数据 → 实时抓取
  console.log(`[daily-analysis] 实时抓取 ${date} 的行情数据...`)
  try {
    const allData = await fetchAllDailyOHLCV(date)

    // 过滤低成交额
    const filtered = allData.filter(d => d.quoteVolume >= minQuoteVolume)

    const items: DailyAnalysisItem[] = filtered.map(d => ({
      symbol: d.symbol,
      base: d.base,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      amplitude: d.amplitude,
      change: d.change,
      quoteVolume: d.quoteVolume,
      isDoji: d.isDoji
    }))

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
      totalSymbols: allData.length,
      filteredCount: items.length,
      allItems: items,
      rankAmplitude: byAmplitude,
      rankGain: byGain,
      rankLoss: byLoss,
      rankDoji: dojis
    }

    // 先写入 DB，再写 Redis 缓存
    try {
      await upsertBatch(allData, date)
    } catch (err) {
      console.error('[daily-analysis] DB upsert failed:', err)
    }

    if (redis.status === 'ready') {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600)
    }

    return c.json({success: true, data: result})
  } catch (err) {
    console.error('[daily-analysis] Live fetch failed:', err)
    return c.json({success: false, error: 'Failed to fetch market data'}, 502)
  }
})

export {router as dailyAnalysisRouter}
