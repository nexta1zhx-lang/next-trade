import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {userConfig} from '../db/schema.js'
import {eq} from 'drizzle-orm'
import {authMiddleware} from '../middleware/auth.js'
import type {Context} from 'hono'

const router = new Hono()

router.use('*', authMiddleware)

// 为 Hono context 扩展 userId
const getUserId = (c: Context) => (c as any).get('userId') as number

/** 默认配置 */
const defaults = {klineMode: 'polling' as const, klineInterval: 10000}

// GET /api/user/config
router.get('/', async c => {
  const userId = getUserId(c)
  try {
    const row = await db
      .select()
      .from(userConfig)
      .where(eq(userConfig.userId, userId))
      .limit(1)
    const cfg = row[0] ?? defaults
    return c.json({success: true, data: cfg})
  } catch (e) {
    return c.json({success: false, error: (e as Error).message}, 500)
  }
})

const updateSchema = z.object({
  klineMode: z.enum(['ws', 'polling']).optional(),
  klineInterval: z.number().int().min(1000).max(300000).optional()
})

// PUT /api/user/config
router.put('/', zValidator('json', updateSchema), async c => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  try {
    await db
      .insert(userConfig)
      .values({userId, ...defaults, ...body, updatedAt: new Date()})
      .onConflictDoUpdate({
        target: userConfig.userId,
        set: {...body, updatedAt: new Date()}
      })
    return c.json({success: true})
  } catch (e) {
    return c.json({success: false, error: (e as Error).message}, 500)
  }
})

export {router as userConfigRouter}
