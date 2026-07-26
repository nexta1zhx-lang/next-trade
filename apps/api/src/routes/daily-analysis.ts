import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {dailyMarketData} from '../db/schema.js'
import {redis} from '../services/redis.js'
import {collectDate} from '../services/dailyMarketService.js'
import type {DailyAnalysisItem, DailyAnalysisResult} from '@nexttrade/shared'
import {eq, and} from 'drizzle-orm'

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
      if (redis.status === 'ready') {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600)
      }
      return c.json({success: true, data: result})
    }
  } catch (err) {
    console.error('[daily-analysis] DB query failed:', err)
    return c.json({success: false, error: 'Database query failed'}, 500)
  }

  // 3. DB 无数据 → 同步采集
  console.log(`[daily-analysis] 触发采集 ${date}...`)
  try {
    await collectDate(date)

    // 采集完成后从 DB 读取
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
      if (redis.status === 'ready') {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600)
      }
      return c.json({success: true, data: result})
    }

    return c.json({success: false, error: '采集完成但无数据'}, 502)
  } catch (err) {
    console.error('[daily-analysis] 采集失败:', err)
    return c.json(
      {success: false, error: `采集失败: ${(err as Error).message}`},
      502
    )
  }
})

export {router as dailyAnalysisRouter}
