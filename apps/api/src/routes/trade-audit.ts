import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {exchangeKeys} from '../db/schema.js'
import {eq, and, desc} from 'drizzle-orm'
import {validateCredentials} from '../services/exchange.js'
import {encrypt, decrypt, maskApiKey} from '../services/crypto.js'
import type {StoredApiKey} from '@nexttrade/shared'

const router = new Hono()

// ─── 所有接口需要登录 ───
router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) {
    return c.json({success: false, error: 'Unauthorized'}, 401)
  }
  await next()
})

// ═════════════════════════════════════
// API Key 管理
// ═════════════════════════════════════

const storeKeySchema = z.object({
  label: z.string().max(50).default(''),
  exchange: z.enum(['binance', 'okx', 'bybit']).default('binance'),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  isTestnet: z.boolean().default(false)
})

// 存储 API Key（绑定后自动拉取最近一周订单）
router.post('/keys', zValidator('json', storeKeySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {label, exchange, apiKey, apiSecret, isTestnet} = c.req.valid('json')

  // 校验 Key 有效性（目前仅支持 Binance）
  if (exchange !== 'binance') {
    return c.json(
      {success: false, error: `Exchange "${exchange}" is not yet supported`},
      400
    )
  }
  const validation = await validateCredentials('binance', {apiKey, apiSecret})
  if (!validation.valid) {
    return c.json(
      {success: false, error: validation.error || 'Invalid API key or secret'},
      400
    )
  }

  // AES-256-GCM 加密后再入库
  const encryptedKey = encrypt(apiKey)
  const encryptedSecret = encrypt(apiSecret)

  const [key] = await db
    .insert(exchangeKeys)
    .values({
      userId,
      label,
      exchange,
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      isTestnet: isTestnet ? 1 : 0
    })
    .returning({
      id: exchangeKeys.id,
      label: exchangeKeys.label,
      createdAt: exchangeKeys.createdAt
    })

  const result: StoredApiKey = {
    id: key.id,
    label: key.label ?? '',
    exchange,
    apiKey: maskApiKey(apiKey),
    isTestnet,
    createdAt: key.createdAt.toISOString()
  }

  return c.json({success: true, data: result}, 201)
})

// 列出 API Key（解密后遮掩显示）
router.get('/keys', async c => {
  const userId = (c as any).get('userId') as number
  const keys = await db
    .select({
      id: exchangeKeys.id,
      label: exchangeKeys.label,
      exchange: exchangeKeys.exchange,
      apiKey: exchangeKeys.apiKey,
      isTestnet: exchangeKeys.isTestnet,
      createdAt: exchangeKeys.createdAt
    })
    .from(exchangeKeys)
    .where(eq(exchangeKeys.userId, userId))
    .orderBy(desc(exchangeKeys.createdAt))

  const result: StoredApiKey[] = keys.map(k => {
    let displayKey = k.apiKey
    try {
      displayKey = maskApiKey(decrypt(k.apiKey))
    } catch {
      displayKey = maskApiKey(k.apiKey)
    }
    return {
      id: k.id,
      label: k.label ?? '',
      exchange: k.exchange,
      apiKey: displayKey,
      isTestnet: k.isTestnet === 1,
      createdAt: k.createdAt.toISOString()
    }
  })

  return c.json({success: true, data: result})
})

// 删除 API Key
router.delete('/keys/:id', async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))

  const [key] = await db
    .delete(exchangeKeys)
    .where(and(eq(exchangeKeys.id, id), eq(exchangeKeys.userId, userId)))
    .returning({id: exchangeKeys.id})

  if (!key) {
    return c.json({success: false, error: 'Key not found'}, 404)
  }

  return c.json({success: true, data: {id: key.id}})
})

export {router as tradeAuditRouter}
