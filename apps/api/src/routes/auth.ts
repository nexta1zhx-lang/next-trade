import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../db/index.js'
import {users} from '../db/schema.js'
import {eq} from 'drizzle-orm'
import {signToken, hashPassword, verifyPassword} from '../services/auth.js'
import {authRateLimit} from '../middleware/rateLimit.js'
import type {AuthUser} from '@nexttrade/shared'

const router = new Hono()

// ─── 注册（带限流） ───
const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100)
})

router.post(
  '/register',
  authRateLimit,
  zValidator('json', registerSchema),
  async c => {
    const {username, password} = c.req.valid('json')

    // 检查用户名是否已存在
    const existing = await db
      .select({id: users.id})
      .from(users)
      .where(eq(users.username, username))
      .limit(1)

    if (existing.length > 0) {
      return c.json({success: false, error: 'Username already exists'}, 409)
    }

    const passwordHash = await hashPassword(password)

    const [newUser] = await db
      .insert(users)
      .values({
        username,
        passwordHash
      })
      .returning({id: users.id, username: users.username})

    if (!newUser) {
      return c.json({success: false, error: 'Failed to create user'}, 500)
    }

    const token = await signToken({
      userId: newUser.id,
      username: newUser.username!
    })

    const result: AuthUser = {
      id: newUser.id,
      username: newUser.username!,
      token
    }

    return c.json({success: true, data: result}, 201)
  }
)

// ─── 登录（带限流） ───
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
})

router.post(
  '/login',
  authRateLimit,
  zValidator('json', loginSchema),
  async c => {
    const {username, password} = c.req.valid('json')

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        passwordHash: users.passwordHash
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1)

    if (!user || !user.passwordHash) {
      return c.json(
        {success: false, error: 'Invalid username or password'},
        401
      )
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return c.json(
        {success: false, error: 'Invalid username or password'},
        401
      )
    }

    const token = await signToken({userId: user.id, username: user.username!})

    const result: AuthUser = {
      id: user.id,
      username: user.username!,
      token
    }

    return c.json({success: true, data: result})
  }
)

// ─── 获取当前用户信息 ───
router.get('/me', async c => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) {
    return c.json({success: false, error: 'Unauthorized'}, 401)
  }

  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      createdAt: users.createdAt
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    return c.json({success: false, error: 'User not found'}, 404)
  }

  return c.json({success: true, data: user})
})

export {router as authRouter}
