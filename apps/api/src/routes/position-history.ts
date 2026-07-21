/**
 * 仓位历史查询路由
 *
 * GET /api/v1/position-history?keyId=1&symbol=BTCUSDT&startDate=2026-06-21&endDate=2026-07-21
 *
 * 调用币安 bapi position/history 接口，返回已平仓的仓位级记录
 */
import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {exchangeKeys} from '../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {fetchPositionHistory} from '../services/positionHistory.js'
import {decrypt} from '../services/crypto.js'
import {apiRateLimit} from '../middleware/rateLimit.js'

const router = new Hono()

router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

const querySchema = z.object({
  keyId: z.coerce.number().int().positive(),
  symbol: z.string().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
})

router.get('/', apiRateLimit, zValidator('query', querySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId, symbol, startDate, endDate} = c.req.valid('query')

  const [stored] = await db
    .select({
      exchange: exchangeKeys.exchange,
      apiKey: exchangeKeys.apiKey,
      apiSecret: exchangeKeys.apiSecret
    })
    .from(exchangeKeys)
    .where(and(eq(exchangeKeys.id, keyId), eq(exchangeKeys.userId, userId)))
    .limit(1)

  if (!stored) return c.json({success: false, error: 'API key not found'}, 404)

  let rawKey: string, rawSecret: string
  try {
    rawKey = decrypt(stored.apiKey)
    rawSecret = decrypt(stored.apiSecret)
  } catch {
    return c.json({success: false, error: 'Failed to decrypt API key'}, 500)
  }

  try {
    const startTime = startDate
      ? new Date(`${startDate}T00:00:00.000Z`).getTime()
      : undefined
    const endTime = endDate
      ? new Date(`${endDate}T23:59:59.999Z`).getTime()
      : undefined

    const records = await fetchPositionHistory({
      apiKey: rawKey,
      apiSecret: rawSecret,
      symbol,
      startTime,
      endTime
    })

    return c.json({success: true, data: {records, count: records.length}})
  } catch (err) {
    return c.json({success: false, error: (err as Error).message}, 502)
  }
})

export {router as positionHistoryRouter}
