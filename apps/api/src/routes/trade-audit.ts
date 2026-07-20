import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {exchangeKeys} from '../db/schema.js'
import {tradeReviews} from '../db/schema/trade.js'
import {eq, and, desc} from 'drizzle-orm'
import {runTradeAudit, validateReadOnlyKey} from '../services/binanceAudit.js'
import {encrypt, decrypt, maskApiKey} from '../services/crypto.js'
import type {
  TradeAuditRecord,
  TradeReview,
  TradeReviewSave,
  StoredApiKey
} from '@nexttrade/shared'

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
  exchange: z.enum(['binance', 'okx']).default('binance'),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  isTestnet: z.boolean().default(false)
})

// 存储 API Key
router.post('/keys', zValidator('json', storeKeySchema), async c => {
  const userId = (c as any).get('userId') as number
  const {exchange, apiKey, apiSecret, isTestnet} = c.req.valid('json')

  // 先校验 Key 有效性
  const validation = await validateReadOnlyKey(apiKey, apiSecret)
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
      exchange,
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      isTestnet: isTestnet ? 1 : 0
    })
    .returning({id: exchangeKeys.id, createdAt: exchangeKeys.createdAt})

  const result: StoredApiKey = {
    id: key.id,
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
      // 无法解密时显示加密片段
      displayKey = maskApiKey(k.apiKey)
    }
    return {
      id: k.id,
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

// ═════════════════════════════════════
// 审计分析
// ═════════════════════════════════════

const analyzeSchema = z.object({
  keyId: z.number().int().positive(),
  symbol: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  orderId: z.string().optional()
})

router.post('/analyze', zValidator('json', analyzeSchema), async c => {
  const userId = (c as any).get('userId') as number
  const {keyId, symbol, startDate, endDate, orderId} = c.req.valid('json')

  // 验证时间范围：最多 31 天
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T23:59:59.999Z`)
  const daysDiff = (end.getTime() - start.getTime()) / (1000 * 3600 * 24)
  if (daysDiff > 31) {
    return c.json(
      {success: false, error: 'Maximum query range is 31 days'},
      400
    )
  }

  // 获取存储的加密 Key
  const [storedKey] = await db
    .select({
      apiKey: exchangeKeys.apiKey,
      apiSecret: exchangeKeys.apiSecret
    })
    .from(exchangeKeys)
    .where(and(eq(exchangeKeys.id, keyId), eq(exchangeKeys.userId, userId)))
    .limit(1)

  if (!storedKey) {
    return c.json({success: false, error: 'API key not found'}, 404)
  }

  // AES-256-GCM 解密
  let rawApiKey: string, rawApiSecret: string
  try {
    rawApiKey = decrypt(storedKey.apiKey)
    rawApiSecret = decrypt(storedKey.apiSecret)
  } catch {
    return c.json(
      {
        success: false,
        error: 'Failed to decrypt API key (check ENCRYPTION_KEY)'
      },
      500
    )
  }

  try {
    const result = await runTradeAudit({
      apiKey: rawApiKey,
      apiSecret: rawApiSecret,
      symbol,
      startDate,
      endDate,
      orderId
    })

    return c.json({
      success: true,
      data: {
        keyId,
        exchange: 'binance',
        startDate,
        endDate,
        records: result.records,
        totalPnl: result.totalPnl,
        totalFee: result.totalFee,
        winRate: result.winRate,
        tradeCount: result.tradeCount,
        tradeVolume: result.totalVolume,
        candles: result.candles,
        markers: result.markers
      }
    })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('rate limit')) {
      return c.json(
        {
          success: false,
          error: 'Binance rate limit exceeded. Please wait and try again.'
        },
        429
      )
    }
    return c.json({success: false, error: message}, 502)
  }
})

// ═════════════════════════════════════
// 交易复盘 CRUD
// ═════════════════════════════════════

const saveReviewSchema = z.object({
  tradeAuditId: z.string().min(1),
  symbol: z.string().min(1),
  strategyTags: z.array(z.string()).default([]),
  errorTags: z.array(z.string()).default([]),
  rating: z.number().int().min(1).max(5).default(3),
  notes: z.string().default('')
})

// 保存/更新复盘
router.post('/reviews', zValidator('json', saveReviewSchema), async c => {
  const userId = (c as any).get('userId') as number
  const body = c.req.valid('json')

  // UPSERT: 同一用户 + 同一 tradeAuditId 则更新
  const existing = await db
    .select({id: tradeReviews.id})
    .from(tradeReviews)
    .where(
      and(
        eq(tradeReviews.userId, userId),
        eq(tradeReviews.tradeAuditId, body.tradeAuditId)
      )
    )
    .limit(1)

  let review
  if (existing.length > 0) {
    // 更新
    const [updated] = await db
      .update(tradeReviews)
      .set({
        strategyTags: body.strategyTags,
        errorTags: body.errorTags,
        rating: body.rating,
        notes: body.notes,
        updatedAt: new Date()
      })
      .where(eq(tradeReviews.id, existing[0].id))
      .returning()

    review = updated
  } else {
    // 插入
    const [inserted] = await db
      .insert(tradeReviews)
      .values({
        userId,
        tradeAuditId: body.tradeAuditId,
        symbol: body.symbol,
        strategyTags: body.strategyTags,
        errorTags: body.errorTags,
        rating: body.rating,
        notes: body.notes
      })
      .returning()

    review = inserted
  }

  const result: TradeReview = {
    id: review.id,
    userId: review.userId,
    tradeAuditId: review.tradeAuditId,
    symbol: review.symbol,
    strategyTags: (review.strategyTags ?? []) as string[],
    errorTags: (review.errorTags ?? []) as string[],
    rating: review.rating ?? 3,
    notes: review.notes ?? '',
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString()
  }

  return c.json({success: true, data: result})
})

// 获取复盘列表
router.get('/reviews', async c => {
  const userId = (c as any).get('userId') as number

  const list = await db
    .select()
    .from(tradeReviews)
    .where(eq(tradeReviews.userId, userId))
    .orderBy(desc(tradeReviews.createdAt))
    .limit(50)

  const result: TradeReview[] = list.map(r => ({
    id: r.id,
    userId: r.userId,
    tradeAuditId: r.tradeAuditId,
    symbol: r.symbol,
    strategyTags: (r.strategyTags ?? []) as string[],
    errorTags: (r.errorTags ?? []) as string[],
    rating: r.rating ?? 3,
    notes: r.notes ?? '',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString()
  }))

  return c.json({success: true, data: result})
})

// 删除复盘
router.delete('/reviews/:id', async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))

  const [deleted] = await db
    .delete(tradeReviews)
    .where(and(eq(tradeReviews.id, id), eq(tradeReviews.userId, userId)))
    .returning({id: tradeReviews.id})

  if (!deleted) {
    return c.json({success: false, error: 'Review not found'}, 404)
  }

  return c.json({success: true, data: {id: deleted.id}})
})

export {router as tradeAuditRouter}
