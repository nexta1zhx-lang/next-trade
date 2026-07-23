import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import ccxt from 'ccxt'
import {db} from '../db/index.js'
import {
  symbolTags,
  symbolJournals,
  symbolReviews,
  symbolDrawings
} from '../db/schema.js'
import {eq, and, desc} from 'drizzle-orm'
import {config} from '../config.js'
import {redis} from '../services/redis.js'
import {authMiddleware} from '../middleware/auth.js'

const router = new Hono<{Variables: {userId: number; username: string}}>()

// ─── 获取 K 线数据 ───
const klinesSchema = z.object({
  timeframe: z.enum(['15m', '1h', '4h', '1d']).default('1h'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  since: z.coerce.number().int().optional()
})

router.get('/:symbol/klines', zValidator('query', klinesSchema), async c => {
  const symbol = decodeURIComponent(c.req.param('symbol'))
  const {timeframe, limit, since} = c.req.valid('query')

  // Redis 缓存（5 分钟）
  const cacheKey = `klines:${symbol}:${timeframe}:${limit}:${since ?? ''}`
  if (redis.status === 'ready') {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return c.json({success: true, data: JSON.parse(cached)})
    }
  }

  try {
    const exchange = new ccxt.binance({
      enableRateLimit: true,
      timeout: 30000,
      options: {defaultType: 'future'}
    })

    if (config.HTTPS_PROXY) {
      process.env.HTTPS_PROXY = config.HTTPS_PROXY
      process.env.HTTP_PROXY = config.HTTPS_PROXY
      await exchange.loadProxyModules()
      exchange.httpsProxy = config.HTTPS_PROXY
    }

    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit)
    const candles = ohlcv.map((c: any) => ({
      time: Math.floor((c[0] ?? 0) / 1000),
      open: c[1] ?? 0,
      high: c[2] ?? 0,
      low: c[3] ?? 0,
      close: c[4] ?? 0,
      volume: c[5] ?? 0
    }))

    // 缓存 5 分钟
    if (redis.status === 'ready') {
      await redis.set(cacheKey, JSON.stringify(candles), 'EX', 300)
    }

    return c.json({success: true, data: candles})
  } catch (err) {
    console.error(`Failed to fetch klines for ${symbol}:`, err)
    return c.json(
      {
        success: false,
        error: (err as Error).message || 'Failed to fetch klines'
      },
      502
    )
  }
})

// ─── 标签 ───

router.get('/:symbol/tags', async c => {
  const symbol = decodeURIComponent(c.req.param('symbol'))

  const tags = await db
    .select()
    .from(symbolTags)
    .where(eq(symbolTags.symbol, symbol))
    .orderBy(desc(symbolTags.createdAt))

  return c.json({success: true, data: tags})
})

const addTagSchema = z.object({
  tag: z.string().min(1).max(50),
  color: z.string().max(7).default('#3b82f6')
})

router.post('/:symbol/tags', zValidator('json', addTagSchema), async c => {
  const symbol = decodeURIComponent(c.req.param('symbol'))
  const {tag, color} = c.req.valid('json')

  try {
    const [created] = await db
      .insert(symbolTags)
      .values({userId: 0, symbol, tag, color})
      .onConflictDoNothing()
      .returning()

    if (!created) {
      return c.json({success: false, error: 'Tag already exists'}, 409)
    }

    return c.json({success: true, data: created}, 201)
  } catch {
    return c.json({success: false, error: 'Tag already exists'}, 409)
  }
})

router.delete('/:symbol/tags/:id', async c => {
  const id = parseInt(c.req.param('id'))

  await db.delete(symbolTags).where(eq(symbolTags.id, id))

  return c.json({success: true, data: {id}})
})

// ─── 日记 ───

router.get('/:symbol/journals', async c => {
  const symbol = decodeURIComponent(c.req.param('symbol'))

  const journals = await db
    .select()
    .from(symbolJournals)
    .where(eq(symbolJournals.symbol, symbol))
    .orderBy(desc(symbolJournals.date))

  return c.json({success: true, data: journals})
})

const saveJournalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  title: z.string().max(200).default(''),
  content: z.string().default('')
})

router.post(
  '/:symbol/journals',
  zValidator('json', saveJournalSchema),
  async c => {
    const symbol = decodeURIComponent(c.req.param('symbol'))
    const {date, title, content} = c.req.valid('json')

    // 同一天同一 symbol 只保留一条，有则更新
    const existing = await db
      .select({id: symbolJournals.id})
      .from(symbolJournals)
      .where(
        and(eq(symbolJournals.symbol, symbol), eq(symbolJournals.date, date))
      )
      .limit(1)

    if (existing.length > 0) {
      const [updated] = await db
        .update(symbolJournals)
        .set({title, content, updatedAt: new Date()})
        .where(eq(symbolJournals.id, existing[0].id))
        .returning()
      return c.json({success: true, data: updated})
    }

    const [created] = await db
      .insert(symbolJournals)
      .values({userId: 0, symbol, date, title, content})
      .returning()

    return c.json({success: true, data: created}, 201)
  }
)

router.put(
  '/:symbol/journals/:id',
  zValidator('json', saveJournalSchema),
  async c => {
    const id = parseInt(c.req.param('id'))
    const {date, title, content} = c.req.valid('json')

    const [updated] = await db
      .update(symbolJournals)
      .set({date, title, content, updatedAt: new Date()})
      .where(eq(symbolJournals.id, id))
      .returning()

    if (!updated) {
      return c.json({success: false, error: 'Journal not found'}, 404)
    }

    return c.json({success: true, data: updated})
  }
)

router.delete('/:symbol/journals/:id', async c => {
  const id = parseInt(c.req.param('id'))

  await db.delete(symbolJournals).where(eq(symbolJournals.id, id))

  return c.json({success: true, data: {id}})
})

// ─── 复盘（合并日记+标签快照，用户隔离） ───

router.get('/:symbol/reviews', authMiddleware, async c => {
  const symbol = decodeURIComponent(c.req.param('symbol')!)
  const userId = c.get('userId') as number

  const reviews = await db
    .select()
    .from(symbolReviews)
    .where(
      and(eq(symbolReviews.symbol, symbol), eq(symbolReviews.userId, userId))
    )
    .orderBy(desc(symbolReviews.date))

  return c.json({success: true, data: reviews})
})

const saveReviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  title: z.string().max(200).default(''),
  content: z.string().default(''),
  tags: z.array(z.object({tag: z.string(), color: z.string()})).default([])
})

router.post(
  '/:symbol/reviews',
  authMiddleware,
  zValidator('json', saveReviewSchema),
  async c => {
    const symbol = decodeURIComponent(c.req.param('symbol')!)
    const userId = c.get('userId') as number
    const {date, title, content, tags} = c.req.valid('json')

    // UPSERT：同一天同一币种同用户只保留一条
    const [review] = await db
      .insert(symbolReviews)
      .values({
        userId,
        symbol,
        date,
        title: title || '',
        content: content || '',
        tags: JSON.stringify(tags)
      })
      .onConflictDoUpdate({
        target: [symbolReviews.symbol, symbolReviews.date],
        set: {
          title: title || '',
          content: content || '',
          tags: JSON.stringify(tags),
          updatedAt: new Date()
        }
      })
      .returning()

    return c.json({success: true, data: review})
  }
)

router.delete('/:symbol/reviews/:id', authMiddleware, async c => {
  const id = parseInt(c.req.param('id')!)
  const userId = c.get('userId') as number
  await db
    .delete(symbolReviews)
    .where(and(eq(symbolReviews.id, id), eq(symbolReviews.userId, userId)))
  return c.json({success: true, data: {id}})
})

// ─── 辅助线 ───

router.get('/:symbol/drawings', authMiddleware, async c => {
  const symbol = decodeURIComponent(c.req.param('symbol')!)
  const userId = c.get('userId') as number

  const [row] = await db
    .select()
    .from(symbolDrawings)
    .where(
      and(eq(symbolDrawings.userId, userId), eq(symbolDrawings.symbol, symbol))
    )
    .limit(1)

  return c.json({success: true, data: row?.data ?? []})
})

const saveDrawingsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['horizontal', 'trendline', 'vertical']),
      time1: z.number(),
      price1: z.number(),
      time2: z.number().optional(),
      price2: z.number().optional()
    })
  )
})

router.put(
  '/:symbol/drawings',
  authMiddleware,
  zValidator('json', saveDrawingsSchema),
  async c => {
    const symbol = decodeURIComponent(c.req.param('symbol')!)
    const userId = c.get('userId') as number
    const {data} = c.req.valid('json')

    const [row] = await db
      .insert(symbolDrawings)
      .values({userId, symbol, data: JSON.stringify(data)})
      .onConflictDoUpdate({
        target: [symbolDrawings.userId, symbolDrawings.symbol],
        set: {data: JSON.stringify(data), updatedAt: new Date()}
      })
      .returning()

    return c.json({success: true, data: row.data})
  }
)

export {router as symbolsRouter}
