import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {favoriteSymbols} from '../db/schema.js'
import {eq, and, desc} from 'drizzle-orm'
import {authMiddleware} from '../middleware/auth.js'
import type {FavoriteSymbol} from '@nexttrade/shared'

const router = new Hono<{Variables: {userId: number; username: string}}>()

// 所有操作都需要登录
router.use('*', authMiddleware)

// ─── GET /api/favorites — 获取当前用户的自选列表 ───
router.get('/', async c => {
  const userId = c.get('userId') as number
  const rows = await db
    .select()
    .from(favoriteSymbols)
    .where(eq(favoriteSymbols.userId, userId))
    .orderBy(desc(favoriteSymbols.createdAt))

  const data: FavoriteSymbol[] = rows.map(r => ({
    id: r.id,
    symbol: r.symbol,
    base: r.base,
    date: r.date,
    createdAt: r.createdAt?.toISOString() ?? ''
  }))

  return c.json({success: true, data})
})

// ─── POST /api/favorites — 添加自选 ───
const createSchema = z.object({
  symbol: z.string().min(1).max(30),
  base: z.string().min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
})

router.post('/', zValidator('json', createSchema), async c => {
  const userId = c.get('userId') as number
  const {symbol, base, date} = c.req.valid('json')

  try {
    const [created] = await db
      .insert(favoriteSymbols)
      .values({userId, symbol, base, date})
      .onConflictDoNothing()
      .returning()

    if (!created) {
      return c.json({success: false, error: 'Already in favorites'}, 409)
    }

    return c.json({success: true, data: {id: created.id}}, 201)
  } catch (e) {
    return c.json({success: false, error: (e as Error).message}, 500)
  }
})

// ─── DELETE /api/favorites/:symbol — 移除自选 ───
router.delete('/:symbol', async c => {
  const userId = c.get('userId') as number
  const symbol = decodeURIComponent(c.req.param('symbol'))

  await db
    .delete(favoriteSymbols)
    .where(
      and(
        eq(favoriteSymbols.userId, userId),
        eq(favoriteSymbols.symbol, symbol)
      )
    )

  return c.json({success: true, data: {symbol}})
})

export {router as favoritesRouter}
