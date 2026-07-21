/**
 * 多交易所仓位查询 API
 *
 * GET /api/v1/positions
 *   - 查询单个交易所账户当前持仓
 *   - 已接入 Redis 5 秒缓存防频率限制
 *   - 需要 JWT 登录 + 已存储的 API Key
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {exchangeKeys} from '../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {getPositions} from '../services/position.service.js'
import {decrypt} from '../services/crypto.js'
import {apiRateLimit} from '../middleware/rateLimit.js'
import type {ExchangeId} from '../types/position.js'

const router = new Hono()

// ─── 所有接口需要登录 ───
router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ─── 查询参数 ───
const querySchema = z.object({
  keyId: z.coerce.number().int().positive()
})

/**
 * GET /api/v1/positions?keyId=1
 *
 * 查询指定 API Key 的当前持仓
 * 先 AES-256-GCM 解密凭据，再通过适配器拉取
 */
router.get('/', apiRateLimit, zValidator('query', querySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId} = c.req.valid('query')

  // 获取存储的加密凭据
  const [stored] = await db
    .select({
      exchange: exchangeKeys.exchange,
      apiKey: exchangeKeys.apiKey,
      apiSecret: exchangeKeys.apiSecret
    })
    .from(exchangeKeys)
    .where(and(eq(exchangeKeys.id, keyId), eq(exchangeKeys.userId, userId)))
    .limit(1)

  if (!stored) {
    return c.json({success: false, error: 'API key not found'}, 404)
  }

  // AES-256-GCM 解密
  let rawKey: string, rawSecret: string
  try {
    rawKey = decrypt(stored.apiKey)
    rawSecret = decrypt(stored.apiSecret)
  } catch {
    return c.json({success: false, error: 'Failed to decrypt API key'}, 500)
  }

  const result = await getPositions(stored.exchange as ExchangeId, {
    apiKey: rawKey,
    apiSecret: rawSecret
  })

  if (!result.success) {
    return c.json(
      {success: false, error: result.error ?? 'Failed to fetch positions'},
      502
    )
  }

  return c.json({
    success: true,
    data: {
      exchange: result.exchange,
      positions: result.positions,
      updatedAt: Date.now()
    }
  })
})

export {router as positionRouter}
