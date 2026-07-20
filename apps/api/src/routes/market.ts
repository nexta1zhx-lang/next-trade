import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {
  syncVolatilityRank,
  queryVolatilityRank
} from '../services/contractSync.js'

const router = new Hono()

// ─── 查询参数 ───
const querySchema = z.object({
  exchange: z.enum(['binance']).default('binance'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
})

/**
 * GET /api/market/contract-volatility
 *
 * 查询合约震荡榜
 * - 不传 date → 查询最新（走缓存 or DB）
 * - 传 date → 查询历史
 * - 查不到 → 返回空，不自动触发同步
 */
router.get(
  '/contract-volatility',
  zValidator('query', querySchema),
  async c => {
    const {exchange, date: rawDate} = c.req.valid('query')
    const date = rawDate ?? new Date().toISOString().slice(0, 10)

    const result = await queryVolatilityRank(exchange, date)
    if (!result) {
      return c.json({
        success: true,
        data: null,
        message: `No data for ${exchange} on ${date}. Run sync first.`
      })
    }

    return c.json({success: true, data: result})
  }
)

/**
 * POST /api/market/contract-volatility/sync
 *
 * 手动触发震荡榜同步
 */
router.post('/contract-volatility/sync', async c => {
  try {
    const result = await syncVolatilityRank('binance')
    return c.json({success: true, data: result, message: 'Sync completed'})
  } catch (err) {
    return c.json({success: false, error: (err as Error).message}, 502)
  }
})

export {router as marketRouter}
