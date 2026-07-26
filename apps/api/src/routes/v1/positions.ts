/**
 * 合约仓位路由
 *
 * GET    /api/v1/positions              — 实时持仓（Binance SDK）+ DB OPEN 仓位
 * GET    /api/v1/positions/history      — 历史平仓记录（分页）
 * GET    /api/v1/positions/summary      — 仓位统计汇总
 * GET    /api/v1/positions/:id          — 仓位详情（含订单+分析）
 * POST   /api/v1/positions/sync         — 手动触发仓位同步
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../../db/index.js'
import {apiKeys} from '../../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {
  getOpenPositionsFromExchange,
  getStoredOpenPositions,
  getClosedPositions,
  getPositionDetail,
  getPositionSummary,
  syncPositionsFromTrades
} from '../../services/positionService.js'

const router = new Hono()

router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ═══════════════════════════════════════════
// GET /api/v1/positions — 实时持仓
// ═══════════════════════════════════════════

router.get('/', async c => {
  const userId = (c as any).get('userId') as number
  const keyId = parseInt(c.req.query('keyId') ?? '')

  const userKeys = await db
    .select({id: apiKeys.id, accountLabel: apiKeys.accountLabel})
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.exchangeId, 'binance'),
        keyId ? eq(apiKeys.id, keyId) : undefined
      )
    )

  const result: Record<
    number,
    {label: string; openPositions: any[]; storedPositions: any[]}
  > = {}

  for (const key of userKeys) {
    let openPositions: any[] = []
    let storedPositions: any[] = []

    try {
      // 从 Binance SDK 获取实时持仓
      openPositions = await getOpenPositionsFromExchange(key.id)
    } catch (err) {
      console.error(
        `[positions] 实时持仓获取失败 key=${key.id}:`,
        (err as Error).message
      )
    }

    try {
      // 从 DB 获取持久化的 OPEN 仓位
      storedPositions = await getStoredOpenPositions(key.id)
    } catch (err) {
      console.error(
        `[positions] 查询 DB 持仓失败 key=${key.id}:`,
        (err as Error).message
      )
    }

    result[key.id] = {
      label: key.accountLabel || `Key #${key.id}`,
      openPositions,
      storedPositions
    }
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// GET /api/v1/positions/history — 历史仓位
// ═══════════════════════════════════════════

const historyQuerySchema = z.object({
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

router.get('/history', zValidator('query', historyQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const params = c.req.valid('query')

  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))

  const allowedIds = userKeys.map(k => k.id)
  if (allowedIds.length === 0) {
    return c.json({success: true, data: {records: [], total: 0}})
  }

  const keyId =
    params.keyId && allowedIds.includes(params.keyId)
      ? params.keyId
      : allowedIds[0]
  const {records, total} = await getClosedPositions(keyId, {
    symbol: params.symbol,
    startDate: params.startDate,
    endDate: params.endDate,
    page: params.page,
    pageSize: params.pageSize
  })

  return c.json({
    success: true,
    data: {records, total, page: params.page, pageSize: params.pageSize}
  })
})

// ═══════════════════════════════════════════
// GET /api/v1/positions/summary — 统计汇总
// ═══════════════════════════════════════════

const summaryQuerySchema = z.object({
  keyId: z.coerce.number().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
})

router.get('/summary', zValidator('query', summaryQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const params = c.req.valid('query')

  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))

  const allowedIds = userKeys.map(k => k.id)
  if (allowedIds.length === 0) {
    return c.json({success: true, data: null})
  }

  const keyId =
    params.keyId && allowedIds.includes(params.keyId)
      ? params.keyId
      : allowedIds[0]

  const summary = await getPositionSummary(keyId, {
    startDate: params.startDate,
    endDate: params.endDate
  })

  return c.json({success: true, data: summary})
})

// ═══════════════════════════════════════════
// GET /api/v1/positions/:id — 仓位详情
// ═══════════════════════════════════════════

router.get('/:id', async c => {
  const userId = (c as any).get('userId') as number
  const positionId = parseInt(c.req.param('id'))

  // 获取该用户所有 Key
  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))

  const allowedIds = userKeys.map(k => k.id)

  // 依次检查每个 Key 是否有该仓位
  for (const keyId of allowedIds) {
    const detail = await getPositionDetail(positionId, keyId)
    if (detail) {
      return c.json({success: true, data: detail})
    }
  }

  return c.json({success: false, error: 'Position not found'}, 404)
})

// ═══════════════════════════════════════════
// POST /api/v1/positions/sync — 触发同步
// ═══════════════════════════════════════════

const syncSchema = z.object({
  keyId: z.coerce.number().optional()
})

router.post('/sync', zValidator('json', syncSchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId} = c.req.valid('json')

  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.exchangeId, 'binance'),
        keyId ? eq(apiKeys.id, keyId) : undefined
      )
    )

  const results: Array<{keyId: number; success: boolean; error?: string}> = []

  for (const key of userKeys) {
    try {
      await syncPositionsFromTrades(key.id)
      results.push({keyId: key.id, success: true})
    } catch (err) {
      results.push({
        keyId: key.id,
        success: false,
        error: (err as Error).message
      })
    }
  }

  return c.json({success: true, data: results})
})

export {router as v1PositionsRouter}
