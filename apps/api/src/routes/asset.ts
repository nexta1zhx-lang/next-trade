/**
 * 资产模块路由 — 精简版
 *
 * GET    /api/asset/current              — 当前最新资产（Redis 缓存）
 * GET    /api/asset/today                — 今日极值 + 分时数据
 * GET    /api/asset/history?days=90      — 历史日 K 线 OHLC
 * GET    /api/asset/detail?apiKeyId=&since= — 历史 5 分钟快照明细
 * POST   /api/asset/collect              — 手动触发采集（当前用户所有 Key）
 * POST   /api/asset/collect/:apiKeyId    — 手动触发指定 Key 采集
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {apiKeys, accountSnapshots} from '../db/schema.js'
import {eq, and, desc} from 'drizzle-orm'
import {sql} from 'drizzle-orm'
import {
  getTodayExtremes,
  getTodayIntraday,
  getDailyOHLC,
  getSnapshots,
  getLatestSnapshot,
  getCachedCurrentAssets
} from '../services/assetService.js'
import {getNetDeposits} from '../services/capitalFlowService.js'
import {
  enqueueAssetSnapshot,
  enqueueUserSnapshots
} from '../services/assetQueue.js'

const router = new Hono()

// ─── 认证中间件 ───
router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ═══════════════════════════════════════════
// GET /api/asset/current — 当前最新资产
// ═══════════════════════════════════════════

router.get('/current', async c => {
  const userId = (c as any).get('userId') as number

  // 先尝试 Redis 缓存
  const cached = await getCachedCurrentAssets(userId)
  if (cached) {
    return c.json({success: true, data: cached})
  }

  // 缓存未命中 → 从 DB 查最新快照
  const userKeys = await db
    .select({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      exchangeId: apiKeys.exchangeId
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, 'binance')))

  // 获取每个 Key 的首日快照日期
  const firstDates = new Map<number, string>()
  for (const key of userKeys) {
    const [first] = await db
      .select({sa: accountSnapshots.snapshotAt})
      .from(accountSnapshots)
      .where(eq(accountSnapshots.apiKeyId, key.id))
      .orderBy(accountSnapshots.snapshotAt)
      .limit(1)
    if (first) firstDates.set(key.id, first.sa.toISOString().slice(0, 10))
  }

  // 始终返回所有 Key，无快照时数据为 null
  const result: Record<number, any> = {}
  for (const key of userKeys) {
    const latest = await getLatestSnapshot(key.id)
    const netDeposit = firstDates.has(key.id)
      ? await getNetDeposits(key.id, firstDates.get(key.id)!)
      : 0

    result[key.id] = latest
      ? {
          totalNetVal: latest.totalNetVal,
          fundingVal: latest.fundingVal,
          spotVal: latest.spotVal,
          futuresUVal: latest.futuresUVal,
          futuresCoinVal: latest.futuresCoinVal,
          earnVal: latest.earnVal,
          snapshotAt: latest.snapshotAt.toISOString(),
          netDeposit
        }
      : {
          label: key.accountLabel || key.exchangeId,
          totalNetVal: 0,
          fundingVal: 0,
          spotVal: 0,
          futuresUVal: 0,
          futuresCoinVal: 0,
          earnVal: 0,
          snapshotAt: null,
          netDeposit: 0
        }
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// GET /api/asset/today — 今日极值 + 分时数据
// ═══════════════════════════════════════════

const todayQuerySchema = z.object({
  apiKeyId: z.coerce.number().optional()
})

router.get('/today', zValidator('query', todayQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {apiKeyId} = c.req.valid('query')

  if (apiKeyId) {
    // 验证归属
    const [key] = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
      .limit(1)
    if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

    const [extremes, intraday] = await Promise.all([
      getTodayExtremes(apiKeyId),
      getTodayIntraday(apiKeyId)
    ])

    return c.json({success: true, data: {extremes, intraday}})
  }

  // 未指定 → 返回所有 Key 的汇总
  const userKeys = await db
    .select({id: apiKeys.id, accountLabel: apiKeys.accountLabel})
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, 'binance')))

  const result: Array<{
    keyId: number
    label: string
    extremes: any
    intraday: any[]
  }> = []

  for (const key of userKeys) {
    const [extremes, intraday] = await Promise.all([
      getTodayExtremes(key.id),
      getTodayIntraday(key.id)
    ])
    result.push({
      keyId: key.id,
      label: key.accountLabel || 'Binance',
      extremes,
      intraday
    })
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// GET /api/asset/history — 历史日 K 线
// ═══════════════════════════════════════════

const historyQuerySchema = z.object({
  apiKeyId: z.coerce.number().optional(),
  days: z.coerce.number().min(1).max(365).default(90)
})

router.get('/history', zValidator('query', historyQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {apiKeyId, days} = c.req.valid('query')

  if (apiKeyId) {
    const [key] = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
      .limit(1)
    if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

    const ohlc = await getDailyOHLC(apiKeyId, days)
    return c.json({success: true, data: ohlc})
  }

  // 合并所有 Key 的日 K 线（按日期取汇总）
  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, 'binance')))

  const allData: Array<{
    keyId: number
    label: string
    ohlc: any[]
  }> = []

  for (const key of userKeys) {
    const ohlc = await getDailyOHLC(key.id, days)
    allData.push({keyId: key.id, label: `Key-${key.id}`, ohlc})
  }

  return c.json({success: true, data: allData})
})

// ═══════════════════════════════════════════
// GET /api/asset/detail — 历史 5 分钟快照明细
// ═══════════════════════════════════════════

const detailQuerySchema = z.object({
  apiKeyId: z.coerce.number(),
  since: z.string().optional() // ISO date string
})

router.get('/detail', zValidator('query', detailQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {apiKeyId, since} = c.req.valid('query')

  // 验证归属
  const [key] = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
    .limit(1)
  if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

  const sinceDate = since
    ? since
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const snapshots = await getSnapshots(apiKeyId, sinceDate)
  return c.json({success: true, data: snapshots})
})

// ═══════════════════════════════════════════
// POST /api/asset/collect — 手动触发采集
// ═══════════════════════════════════════════

router.post('/collect', async c => {
  const userId = (c as any).get('userId') as number
  const count = await enqueueUserSnapshots(userId)

  if (count === 0) {
    return c.json({success: false, error: 'No active Binance keys found'}, 400)
  }

  return c.json({
    success: true,
    data: {queued: count, message: `已投递 ${count} 个采集任务`}
  })
})

router.post('/collect/:apiKeyId', async c => {
  const userId = (c as any).get('userId') as number
  const apiKeyId = Number(c.req.param('apiKeyId'))

  const [key] = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
    .limit(1)

  if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

  await enqueueAssetSnapshot(apiKeyId)
  return c.json({
    success: true,
    data: {apiKeyId, message: '采集任务已投递'}
  })
})

export {router as assetRouter}
