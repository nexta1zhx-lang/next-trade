/**
 * 增量权益 API 路由
 *
 * GET  /api/v2/equity/summary        — 当前权益摘要
 * GET  /api/v2/equity/curve          — 权益曲线（小时 bar）
 * GET  /api/v2/equity/today          — 今日分时
 * POST /api/v2/equity/collect        — 手动触发采集
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {apiKeys} from '../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {
  getEquitySummary,
  getEquityCurve,
  getTodayIntraday
} from '../services/equityTracker.js'
import {collectAndPublish, collectAllKeys} from '../services/equityCollector.js'

const router = new Hono()

router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ═══════════════════════════════════════════
// GET /api/v2/equity/summary — 当前权益摘要
// ═══════════════════════════════════════════

const summaryQuerySchema = z.object({
  keyId: z.coerce.number().optional()
})

router.get('/summary', zValidator('query', summaryQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId} = c.req.valid('query')

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

  if (userKeys.length === 0) {
    return c.json({success: true, data: {}})
  }

  const result: Record<number, any> = {}

  for (const key of userKeys) {
    const summary = await getEquitySummary(key.id)
    result[key.id] = summary
      ? {
          label: key.accountLabel || `Key #${key.id}`,
          ...summary
        }
      : {
          label: key.accountLabel || `Key #${key.id}`,
          currentEquity: 0,
          cumulativePnl: 0,
          simpleRoi: 0,
          twRoi: 0,
          maxDrawdown: 0,
          dailyExtremes: null,
          baseline: null
        }
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// GET /api/v2/equity/curve — 权益曲线
// ═══════════════════════════════════════════

const curveQuerySchema = z.object({
  keyId: z.coerce.number().optional(),
  days: z.coerce.number().min(0).optional()
})

router.get('/curve', zValidator('query', curveQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId, days} = c.req.valid('query')

  if (keyId) {
    const [key] = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .limit(1)
    if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

    const curve = await getEquityCurve(keyId, days || 9999)
    return c.json({success: true, data: curve})
  }

  // 未指定 keyId 时返回所有 Key
  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, 'binance')))

  const result: Record<number, any> = {}
  for (const key of userKeys) {
    result[key.id] = await getEquityCurve(key.id, days)
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// GET /api/v2/equity/today — 今日分时
// ═══════════════════════════════════════════

const todayQuerySchema = z.object({
  keyId: z.coerce.number().optional()
})

router.get('/today', zValidator('query', todayQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId} = c.req.valid('query')

  if (keyId) {
    const [key] = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .limit(1)
    if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

    const intraday = await getTodayIntraday(keyId)
    return c.json({success: true, data: intraday})
  }

  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, 'binance')))

  const result: Record<number, any> = {}
  for (const key of userKeys) {
    result[key.id] = await getTodayIntraday(key.id)
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// POST /api/v2/equity/collect — 手动触发采集
// ═══════════════════════════════════════════

router.post('/collect', async c => {
  const userId = (c as any).get('userId') as number

  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.exchangeId, 'binance'),
        eq(apiKeys.status, 'ACTIVE')
      )
    )

  const results: Array<{keyId: number; success: boolean; error?: string}> = []

  for (const key of userKeys) {
    try {
      await collectAndPublish(key.id)
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

export {router as equityRouter}
