/**
 * V1 API Key 管理路由
 *
 * POST   /api/v1/keys             — 绑定并校验 API Key
 * GET    /api/v1/keys             — 列出所有 Key（含同步状态）
 * GET    /api/v1/keys/:id         — 获取单个 Key 详情
 * PUT    /api/v1/keys/:id         — 更新 Key（标签/更换 Key）
 * PATCH  /api/v1/keys/:id/status  — 暂停/恢复同步
 * DELETE /api/v1/keys/:id         — 删除 Key（保留历史数据）
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../../db/index.js'
import {apiKeys} from '../../db/schema.js'
import {eq, and, desc} from 'drizzle-orm'
import {encrypt, decrypt, maskApiKey} from '../../services/crypto.js'
import {
  validateExchangeKey,
  getExchangeDisplayName
} from '../../services/exchange/validator.js'
import type {StoredApiKey, ApiKeyDetail, KeyStatus} from '@nexttrade/shared'

const router = new Hono()

router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ═══════════════════════════════════════════
// POST /api/v1/keys — 绑定 API Key
// ═══════════════════════════════════════════

const createSchema = z.object({
  exchangeId: z.enum(['binance', 'okx', 'bybit', 'bitget', 'gate', 'mexc']),
  apiKey: z.string().min(1, 'API Key 不能为空'),
  apiSecret: z.string().min(1, 'Secret 不能为空'),
  passphrase: z.string().optional(),
  label: z.string().max(50).default(''),
  isTestnet: z.boolean().default(false)
})

router.post('/', zValidator('json', createSchema), async c => {
  const userId = (c as any).get('userId') as number
  const {exchangeId, apiKey, apiSecret, passphrase, label, isTestnet} =
    c.req.valid('json')

  const validation = await validateExchangeKey(exchangeId, {
    apiKey,
    apiSecret,
    passphrase
  })
  if (!validation.valid) {
    return c.json(
      {success: false, error: validation.error || 'API Key 校验失败'},
      400
    )
  }

  // 非只读 Key 仅警告，不强制拒绝
  if (!validation.isReadOnly) {
    console.warn(
      `[keys] User ${userId} bound non-read-only key for ${exchangeId}`
    )
  }

  const encryptedSecret = encrypt(apiSecret)
  const encryptedPassphrase = passphrase ? encrypt(passphrase) : null

  const [key] = await db
    .insert(apiKeys)
    .values({
      userId,
      exchangeId,
      accountLabel: label,
      apiKey,
      secretEnc: encryptedSecret,
      passphraseEnc: encryptedPassphrase,
      status: 'ACTIVE'
    })
    .returning({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      status: apiKeys.status,
      createdAt: apiKeys.createdAt
    })

  const result: StoredApiKey = {
    id: key.id,
    label: key.accountLabel ?? '',
    exchange: exchangeId,
    apiKey: maskApiKey(apiKey),
    status: key.status as KeyStatus,
    lastSyncAt: null,
    isTestnet,
    createdAt: key.createdAt.toISOString()
  }

  return c.json({success: true, data: result}, 201)
})

// ═══════════════════════════════════════════
// GET /api/v1/keys — 列出所有 Key
// ═══════════════════════════════════════════

router.get('/', async c => {
  const userId = (c as any).get('userId') as number

  const keys = await db
    .select({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      exchangeId: apiKeys.exchangeId,
      apiKey: apiKeys.apiKey,
      status: apiKeys.status,
      lastSyncAt: apiKeys.lastSyncAt,
      isTestnet: apiKeys.isTestnet,
      createdAt: apiKeys.createdAt
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt))

  const result: StoredApiKey[] = keys.map(k => ({
    id: k.id,
    label: k.accountLabel ?? '',
    exchange: k.exchangeId,
    apiKey: maskApiKey(k.apiKey),
    status: k.status as KeyStatus,
    lastSyncAt: k.lastSyncAt?.toISOString() ?? null,
    isTestnet: k.isTestnet === 1,
    createdAt: k.createdAt.toISOString()
  }))

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// GET /api/v1/keys/:id — 单个 Key 详情
// ═══════════════════════════════════════════

router.get('/:id', async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .limit(1)

  if (!key) return c.json({success: false, error: 'Key not found'}, 404)

  const result: ApiKeyDetail = {
    id: key.id,
    label: key.accountLabel ?? '',
    exchange: key.exchangeId,
    apiKey: maskApiKey(key.apiKey),
    status: key.status as KeyStatus,
    lastSyncAt: key.lastSyncAt?.toISOString() ?? null,
    isTestnet: key.isTestnet === 1,
    createdAt: key.createdAt.toISOString(),
    exchangeDisplay: getExchangeDisplayName(key.exchangeId)
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// PUT /api/v1/keys/:id — 更新 Key
// ═══════════════════════════════════════════

const updateSchema = z.object({
  label: z.string().max(50).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
  passphrase: z.string().optional()
})

router.put('/:id', zValidator('json', updateSchema), async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))
  const body = c.req.valid('json')

  const [existing] = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .limit(1)

  if (!existing) return c.json({success: false, error: 'Key not found'}, 404)

  const updateData: Record<string, any> = {}
  if (body.label !== undefined) updateData.accountLabel = body.label

  if (body.apiKey && body.apiSecret) {
    const validation = await validateExchangeKey('binance', {
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      passphrase: body.passphrase
    })
    if (!validation.valid) {
      return c.json(
        {success: false, error: validation.error || '新 API Key 校验失败'},
        400
      )
    }
    updateData.apiKey = body.apiKey
    updateData.secretEnc = encrypt(body.apiSecret)
    if (body.passphrase) updateData.passphraseEnc = encrypt(body.passphrase)
    updateData.lastTradeId = null
  }

  updateData.updatedAt = new Date()

  const [updated] = await db
    .update(apiKeys)
    .set(updateData)
    .where(eq(apiKeys.id, id))
    .returning({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      exchangeId: apiKeys.exchangeId,
      apiKey: apiKeys.apiKey,
      status: apiKeys.status,
      lastSyncAt: apiKeys.lastSyncAt,
      createdAt: apiKeys.createdAt
    })

  const result: StoredApiKey = {
    id: updated.id,
    label: updated.accountLabel ?? '',
    exchange: updated.exchangeId,
    apiKey: maskApiKey(updated.apiKey),
    status: updated.status as KeyStatus,
    lastSyncAt: updated.lastSyncAt?.toISOString() ?? null,
    isTestnet: false,
    createdAt: updated.createdAt.toISOString()
  }

  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// PATCH /api/v1/keys/:id/status — 暂停/恢复
// ═══════════════════════════════════════════

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED'])
})

router.patch('/:id/status', zValidator('json', statusSchema), async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))
  const {status} = c.req.valid('json')

  const [updated] = await db
    .update(apiKeys)
    .set({status, updatedAt: new Date()})
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({id: apiKeys.id, status: apiKeys.status})

  if (!updated) return c.json({success: false, error: 'Key not found'}, 404)
  return c.json({
    success: true,
    data: {id: updated.id, status: updated.status as KeyStatus}
  })
})

// ═══════════════════════════════════════════
// DELETE /api/v1/keys/:id — 删除 Key
// ═══════════════════════════════════════════

router.delete('/:id', async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))

  const [deleted] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({id: apiKeys.id})

  if (!deleted) return c.json({success: false, error: 'Key not found'}, 404)
  return c.json({success: true, data: {id: deleted.id}})
})

export {router as v1KeysRouter}
