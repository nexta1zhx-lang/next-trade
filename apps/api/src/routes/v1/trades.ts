/**
 * V1 成交查询路由
 *
 * GET /api/v1/trades            — 查询成交记录（分页、过滤）
 * GET /api/v1/trades/stats      — 交易统计汇总
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../../db/index.js'
import {trades, apiKeys} from '../../db/schema.js'
import {eq, and, desc, sql} from 'drizzle-orm'

const router = new Hono()

router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ═══════════════════════════════════════════
// GET /api/v1/trades — 查询成交记录
// ═══════════════════════════════════════════

const querySchema = z.object({
  keyId: z.coerce.number().optional(),
  symbol: z.string().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().max(200).default(50)
})

router.get('/', zValidator('query', querySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId, symbol, startDate, endDate, page, pageSize} =
    c.req.valid('query')

  // 构建条件
  const conditions = []

  // 只查询属于该用户的 Key 的成交
  const userKeyIds = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))

  if (userKeyIds.length === 0) {
    return c.json({
      success: true,
      data: {records: [], total: 0, page, pageSize}
    })
  }

  const allowedIds = userKeyIds.map(k => k.id)
  conditions.push(
    sql`${trades.apiKeyId} = ANY(ARRAY[${sql.join(allowedIds, sql`, `)}]::int[])`
  )

  if (keyId) {
    // 校验 keyId 是否属于该用户
    if (!allowedIds.includes(keyId)) {
      return c.json({success: false, error: 'API Key not found'}, 404)
    }
    conditions.push(eq(trades.apiKeyId, keyId))
  }

  if (symbol) {
    conditions.push(eq(trades.symbol, symbol))
  }

  if (startDate) {
    conditions.push(
      sql`${trades.executedAt} >= ${startDate}T00:00:00.000Z::timestamptz`
    )
  }
  if (endDate) {
    conditions.push(
      sql`${trades.executedAt} <= ${endDate}T23:59:59.999Z::timestamptz`
    )
  }

  const where = and(...conditions)

  // 查询总数
  const [countResult] = await db
    .select({count: sql<number>`count(*)::int`})
    .from(trades)
    .where(where)

  const total = countResult?.count ?? 0

  // 分页查询
  const offset = (page - 1) * pageSize
  const records = await db
    .select()
    .from(trades)
    .where(where)
    .orderBy(desc(trades.executedAt))
    .limit(pageSize)
    .offset(offset)

  return c.json({
    success: true,
    data: {
      records,
      total,
      page,
      pageSize
    }
  })
})

// ═══════════════════════════════════════════
// GET /api/v1/trades/stats — 交易统计
// ═══════════════════════════════════════════

const statsSchema = z.object({
  keyId: z.coerce.number().optional(),
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

router.get('/stats', zValidator('query', statsSchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId, symbol, startDate, endDate} = c.req.valid('query')

  const userKeyIds = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))

  if (userKeyIds.length === 0) {
    return c.json({success: true, data: null})
  }

  const conditions = [
    sql`${trades.apiKeyId} = ANY(ARRAY[${sql.join(
      userKeyIds.map(k => k.id),
      sql`, `
    )}]::int[])`
  ]

  if (keyId) conditions.push(eq(trades.apiKeyId, keyId))
  if (symbol) conditions.push(eq(trades.symbol, symbol))
  if (startDate)
    conditions.push(
      sql`${trades.executedAt} >= ${startDate}T00:00:00.000Z::timestamptz`
    )
  if (endDate)
    conditions.push(
      sql`${trades.executedAt} <= ${endDate}T23:59:59.999Z::timestamptz`
    )

  const where = and(...conditions)

  const [stats] = await db
    .select({
      tradeCount: sql<number>`count(*)::int`,
      totalPnl: sql<string>`coalesce(sum(realized_pnl::numeric), 0)`,
      totalFee: sql<string>`coalesce(sum(fee_usdt::numeric), 0)`,
      winCount: sql<number>`count(*) filter (where realized_pnl::numeric > 0)::int`,
      lossCount: sql<number>`count(*) filter (where realized_pnl::numeric < 0)::int`,
      totalQuoteQty: sql<string>`coalesce(sum(quote_qty::numeric), 0)`
    })
    .from(trades)
    .where(where)

  const tradeCount = stats?.tradeCount ?? 0
  const totalPnl = parseFloat(stats?.totalPnl ?? '0')
  const totalFee = parseFloat(stats?.totalFee ?? '0')
  const winCount = stats?.winCount ?? 0
  const lossCount = stats?.lossCount ?? 0

  return c.json({
    success: true,
    data: {
      tradeCount,
      totalPnl,
      totalFee,
      netPnl: totalPnl - totalFee,
      winCount,
      lossCount,
      winRate: tradeCount > 0 ? (winCount / tradeCount) * 100 : 0,
      avgPnl: tradeCount > 0 ? totalPnl / tradeCount : 0,
      totalVolume: parseFloat(stats?.totalQuoteQty ?? '0')
    }
  })
})

export {router as v1TradesRouter}
