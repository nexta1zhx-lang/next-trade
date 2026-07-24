/**
 * 资产快照路由
 *
 * GET    /api/asset/snapshots?apiKeyId=&days=30  — 资产曲线数据
 * GET    /api/asset/overview?apiKeyId=            — 最新资产概览
 * POST   /api/asset/collect                       — 手动触发采集（当前用户所有 Key）
 * POST   /api/asset/collect/:apiKeyId             — 手动触发指定 Key 采集
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {apiKeys} from '../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {
  collectAssetSnapshot,
  collectAllUserKeys,
  getSnapshots,
  getLatestSnapshot
} from '../services/assetService.js'
import {syncAllKeys} from '../services/syncService.js'
import type {AssetSnapshot, AssetOverview} from '@nexttrade/shared'

const router = new Hono()

// ─── 认证中间件 ───
router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ═══════════════════════════════════════════
// GET /api/asset/snapshots
// ═══════════════════════════════════════════

const snapshotsQuerySchema = z.object({
  apiKeyId: z.coerce.number().optional(),
  days: z.coerce.number().min(1).max(365).default(30),
  includeReconstructed: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v !== 'false')
})

router.get('/snapshots', zValidator('query', snapshotsQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {apiKeyId, days, includeReconstructed} = c.req.valid('query')

  if (apiKeyId) {
    // 验证该 Key 归属当前用户
    const [key] = await db
      .select({
        id: apiKeys.id,
        accountLabel: apiKeys.accountLabel,
        exchangeId: apiKeys.exchangeId
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
      .limit(1)

    if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

    const rows = await getSnapshots(apiKeyId, days, includeReconstructed)
    const snapshots: AssetSnapshot[] = rows.map(r => ({
      snapDate: r.snapDate,
      totalEquity: Number(r.totalEquity),
      spotValue: Number(r.spotValue),
      contractEquity: Number(r.contractEquity),
      unrealizedPnl: Number(r.unrealizedPnl),
      fundingValue: Number(r.fundingValue),
      earnValue: Number(r.earnValue),
      marginEquity: Number(r.marginEquity),
      marginDebt: Number(r.marginDebt)
    }))

    return c.json({
      success: true,
      data: {
        keyId: apiKeyId,
        label: key.accountLabel || key.exchangeId,
        snapshots
      }
    })
  }

  // 未指定 apiKeyId → 返回用户所有 Key 的快照
  const userKeys = await db
    .select({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      exchangeId: apiKeys.exchangeId
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, 'binance')))

  const allSnapshots: Array<{
    keyId: number
    label: string
    snapshots: AssetSnapshot[]
  }> = []
  for (const key of userKeys) {
    const rows = await getSnapshots(key.id, days, includeReconstructed)
    const snapshots: AssetSnapshot[] = rows.map(r => ({
      snapDate: r.snapDate,
      totalEquity: Number(r.totalEquity),
      spotValue: Number(r.spotValue),
      contractEquity: Number(r.contractEquity),
      unrealizedPnl: Number(r.unrealizedPnl),
      fundingValue: Number(r.fundingValue),
      earnValue: Number(r.earnValue),
      marginEquity: Number(r.marginEquity),
      marginDebt: Number(r.marginDebt)
    }))
    allSnapshots.push({
      keyId: key.id,
      label: key.accountLabel || key.exchangeId,
      snapshots
    })
  }

  return c.json({success: true, data: allSnapshots})
})

// ═══════════════════════════════════════════
// GET /api/asset/overview
// ═══════════════════════════════════════════

const overviewQuerySchema = z.object({
  apiKeyId: z.coerce.number().optional()
})

router.get('/overview', zValidator('query', overviewQuerySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {apiKeyId} = c.req.valid('query')

  if (apiKeyId) {
    const [key] = await db
      .select({
        id: apiKeys.id,
        accountLabel: apiKeys.accountLabel,
        exchangeId: apiKeys.exchangeId
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
      .limit(1)

    if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

    const latest = await getLatestSnapshot(apiKeyId)
    if (!latest) return c.json({success: true, data: null})

    const overview: AssetOverview = {
      apiKeyId: latest.apiKeyId,
      label: key.accountLabel || key.exchangeId,
      exchange: key.exchangeId,
      snapDate: latest.snapDate,
      totalEquity: latest.totalEquity,
      spotValue: latest.spotValue,
      contractEquity: latest.contractEquity,
      unrealizedPnl: latest.unrealizedPnl,
      fundingValue: latest.fundingValue,
      earnValue: latest.earnValue,
      marginEquity: latest.marginEquity,
      marginDebt: latest.marginDebt
    }
    return c.json({success: true, data: overview})
  }

  // 返回用户所有 Key 的最新概览
  const userKeys = await db
    .select({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      exchangeId: apiKeys.exchangeId
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchangeId, 'binance')))

  const overviews: AssetOverview[] = []
  for (const key of userKeys) {
    const latest = await getLatestSnapshot(key.id)
    if (latest) {
      overviews.push({
        apiKeyId: latest.apiKeyId,
        label: key.accountLabel || key.exchangeId,
        exchange: key.exchangeId,
        snapDate: latest.snapDate,
        totalEquity: latest.totalEquity,
        spotValue: latest.spotValue,
        contractEquity: latest.contractEquity,
        unrealizedPnl: latest.unrealizedPnl,
        fundingValue: latest.fundingValue,
        earnValue: latest.earnValue,
        marginEquity: latest.marginEquity,
        marginDebt: latest.marginDebt
      })
    }
  }

  return c.json({success: true, data: overviews})
})

// ═══════════════════════════════════════════
// POST /api/asset/collect — 手动触发采集
// ═══════════════════════════════════════════

router.post('/collect', async c => {
  const userId = (c as any).get('userId') as number

  const results = await collectAllUserKeys(userId)
  if (results.length === 0) {
    return c.json({success: false, error: 'No active Binance keys found'}, 400)
  }

  return c.json({
    success: true,
    data: results.map(r => ({
      apiKeyId: r.apiKeyId,
      snapDate: r.snapDate,
      totalEquity: r.totalEquity
    }))
  })
})

router.post('/collect/:apiKeyId', async c => {
  const userId = (c as any).get('userId') as number
  const apiKeyId = Number(c.req.param('apiKeyId'))

  // 验证归属
  const [key] = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
    .limit(1)

  if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

  const result = await collectAssetSnapshot(apiKeyId)
  return c.json({
    success: true,
    data: {
      apiKeyId: result.apiKeyId,
      snapDate: result.snapDate,
      totalEquity: result.totalEquity
    }
  })
})

// ═══════════════════════════════════════════
// POST /api/asset/sync — 拉取币安 SAPI 历史快照（仅首次执行一次）
// ═══════════════════════════════════════════

import {assetSnapshots} from '../db/schema.js'
import {desc} from 'drizzle-orm'

async function hasReconstructedData(apiKeyId: number): Promise<boolean> {
  const [row] = await db
    .select({id: assetSnapshots.id})
    .from(assetSnapshots)
    .where(
      and(
        eq(assetSnapshots.apiKeyId, apiKeyId),
        eq(assetSnapshots.isReconstructed, true)
      )
    )
    .limit(1)
  return !!row
}

router.post('/sync', async c => {
  const userId = (c as any).get('userId') as number

  // 检查每个 Key 是否已有历史快照
  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.exchangeId, 'binance'),
        eq(apiKeys.status, 'ACTIVE')
      )
    )

  const results: Array<{
    apiKeyId: number
    snapshots: number
    skipped: boolean
  }> = []
  for (const k of keys) {
    const alreadyDone = await hasReconstructedData(k.id)
    if (alreadyDone) {
      results.push({apiKeyId: k.id, snapshots: 0, skipped: true})
      continue
    }
    // 先采集当前快照
    await collectAssetSnapshot(k.id)
    // 再拉取历史 SAPI 快照
    const {syncHistoricalSnapshots} = await import('../services/syncService.js')
    const r = await syncHistoricalSnapshots(k.id)
    results.push({apiKeyId: k.id, snapshots: r.snapshots, skipped: false})
  }

  if (results.length === 0) {
    return c.json({success: false, error: '没有找到 Binance Key'}, 400)
  }

  return c.json({success: true, data: results})
})

router.post('/sync/:apiKeyId', async c => {
  const userId = (c as any).get('userId') as number
  const apiKeyId = Number(c.req.param('apiKeyId'))

  const [key] = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
    .limit(1)

  if (!key) return c.json({success: false, error: 'API Key not found'}, 404)

  // 已同步过则跳过
  if (await hasReconstructedData(apiKeyId)) {
    return c.json({
      success: true,
      data: {apiKeyId, snapshots: 0, skipped: true}
    })
  }

  await collectAssetSnapshot(apiKeyId)
  const {syncHistoricalSnapshots} = await import('../services/syncService.js')
  const result = await syncHistoricalSnapshots(apiKeyId)
  return c.json({
    success: true,
    data: {apiKeyId, snapshots: result.snapshots, skipped: false}
  })
})

export {router as assetRouter}
