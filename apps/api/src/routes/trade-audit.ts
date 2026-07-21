/**
 * API Key 管理路由 — 适配新 api_keys 表
 *
 * POST   /keys        — 校验并存储 API Key
 * GET    /keys        — 列出当前用户的所有 Key
 * DELETE /keys/:id    — 删除指定 Key
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {apiKeys} from '../db/schema.js'
import {eq, and, desc} from 'drizzle-orm'
import {validateCredentials} from '../services/exchange.js'
import {encrypt, maskApiKey} from '../services/crypto.js'
import type {StoredApiKey} from '@nexttrade/shared'

const router = new Hono()

router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

const storeKeySchema = z.object({
  label: z.string().max(50).default(''),
  exchangeId: z.enum(['binance', 'okx', 'bybit']).default('binance'),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1)
})

router.post('/keys', zValidator('json', storeKeySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {label, exchangeId, apiKey, apiSecret} = c.req.valid('json')

  if (exchangeId !== 'binance') {
    return c.json(
      {success: false, error: `Exchange "${exchangeId}" is not yet supported`},
      400
    )
  }

  const validation = await validateCredentials(exchangeId, {apiKey, apiSecret})
  if (!validation.valid) {
    return c.json(
      {success: false, error: validation.error || 'Invalid API key or secret'},
      400
    )
  }

  const encryptedSecret = encrypt(apiSecret)

  const [key] = await db
    .insert(apiKeys)
    .values({
      userId,
      accountLabel: label,
      exchangeId,
      apiKey,
      secretEnc: encryptedSecret
    })
    .returning({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      createdAt: apiKeys.createdAt
    })

  const result: StoredApiKey = {
    id: key.id,
    label: key.accountLabel ?? '',
    exchange: exchangeId,
    apiKey: maskApiKey(apiKey),
    status: 'ACTIVE',
    lastSyncAt: null,
    isTestnet: false,
    createdAt: key.createdAt.toISOString()
  }

  return c.json({success: true, data: result}, 201)
})

router.get('/keys', async c => {
  const userId = (c as any).get('userId') as number

  const keys = await db
    .select({
      id: apiKeys.id,
      accountLabel: apiKeys.accountLabel,
      exchangeId: apiKeys.exchangeId,
      apiKey: apiKeys.apiKey,
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
    status: 'ACTIVE',
    lastSyncAt: null,
    isTestnet: false,
    createdAt: k.createdAt.toISOString()
  }))

  return c.json({success: true, data: result})
})

router.delete('/keys/:id', async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))

  const [key] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({id: apiKeys.id})

  if (!key) return c.json({success: false, error: 'Key not found'}, 404)
  return c.json({success: true, data: {id: key.id}})
})

export {router as tradeAuditRouter}
