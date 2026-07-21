import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {getWatchlist} from '../services/operatorEngine.js'
import {runDailyWatchlistSync} from '../cron/dailySync.js'

const router = new Hono()

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
})

const syncSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
})

/**
 * GET /api/market/watchlist?date=2026-07-20
 *
 * 返回指定日期的 watchlist（从 Redis 读取）
 */
router.get('/', zValidator('query', querySchema), async c => {
  const {date} = c.req.valid('query')
  const items = await getWatchlist(date)
  return c.json({
    success: true,
    data: {
      date: date ?? new Date().toISOString().slice(0, 10),
      items
    }
  })
})

/**
 * POST /api/market/watchlist/sync?date=2026-07-20
 *
 * 手动触发 watchlist 同步。
 * 可选 date 参数，不传则使用今天日期。
 * 数据来源于每日行情相同的 CCXT 抓取流程。
 */
router.post('/sync', zValidator('query', syncSchema), async c => {
  const {date} = c.req.valid('query')
  try {
    const result = await runDailyWatchlistSync(date)
    return c.json({
      success: true,
      data: result,
      message: 'Watchlist sync completed'
    })
  } catch (err) {
    return c.json({success: false, error: (err as Error).message}, 502)
  }
})

export {router as watchlistRouter}
