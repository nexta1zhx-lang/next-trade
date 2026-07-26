/**
 * 发布订阅路由
 *
 * GET    /api/v1/publish/settings       — 获取我的发布设置
 * PUT    /api/v1/publish/settings       — 更新我的发布设置
 * GET    /api/v1/publish/users          — 浏览/搜索公开用户
 * GET    /api/v1/publish/following      — 我关注的人
 * POST   /api/v1/publish/follow         — 关注用户
 * DELETE /api/v1/publish/follow/:userId — 取消关注
 * GET    /api/v1/publish/user/:userId   — 查看用户公开数据（按需拉取）
 * GET    /api/v1/publish/stats          — 我的发布统计（粉丝数/关注数）
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {authMiddleware} from '../middleware/auth.js'
import {
  getPublishSettings,
  updatePublishSettings,
  searchPublicUsers,
  getMyFollowing,
  followUser,
  unfollowUser,
  getPublicUserData,
  getFollowerCount,
  getFollowingCount,
  isFollowing
} from '../services/publishService.js'
import type {Context} from 'hono'

const router = new Hono()

router.use('*', authMiddleware)

const getUserId = (c: Context) => (c as any).get('userId') as number

// ═══════════════════════════════════════════
// GET /api/v1/publish/settings
// ═══════════════════════════════════════════

router.get('/settings', async c => {
  const userId = getUserId(c)
  const settings = await getPublishSettings(userId)
  const followerCount = await getFollowerCount(userId)
  const followingCount = await getFollowingCount(userId)
  return c.json({
    success: true,
    data: {...settings, followerCount, followingCount}
  })
})

// ═══════════════════════════════════════════
// PUT /api/v1/publish/settings
// ═══════════════════════════════════════════

const updateSettingsSchema = z.object({
  isPublic: z.boolean().optional(),
  showPositions: z.boolean().optional(),
  positionGranularity: z.enum(['basic', 'full']).optional(),
  showCapital: z.boolean().optional(),
  showOrders: z.boolean().optional()
})

router.put('/settings', zValidator('json', updateSettingsSchema), async c => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const settings = await updatePublishSettings(userId, body)
  return c.json({success: true, data: settings})
})

// ═══════════════════════════════════════════
// GET /api/v1/publish/users — 搜索公开用户
// ═══════════════════════════════════════════

const searchSchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().max(100).default(50)
})

router.get('/users', zValidator('query', searchSchema), async c => {
  const userId = getUserId(c)
  const {q, page, pageSize} = c.req.valid('query')
  const result = await searchPublicUsers(userId, q, page, pageSize)
  return c.json({success: true, data: result})
})

// ═══════════════════════════════════════════
// GET /api/v1/publish/following — 我关注的人
// ═══════════════════════════════════════════

router.get('/following', async c => {
  const userId = getUserId(c)
  const list = await getMyFollowing(userId)
  return c.json({success: true, data: list})
})

// ═══════════════════════════════════════════
// POST /api/v1/publish/follow — 关注用户
// ═══════════════════════════════════════════

const followSchema = z.object({
  userId: z.number().int().positive()
})

router.post('/follow', zValidator('json', followSchema), async c => {
  const followerId = getUserId(c)
  const {userId: followingId} = c.req.valid('json')

  try {
    await followUser(followerId, followingId)
    return c.json({success: true, data: {followingId}})
  } catch (err) {
    return c.json({success: false, error: (err as Error).message}, 400)
  }
})

// ═══════════════════════════════════════════
// DELETE /api/v1/publish/follow/:userId — 取消关注
// ═══════════════════════════════════════════

router.delete('/follow/:userId', async c => {
  const followerId = getUserId(c)
  const followingId = parseInt(c.req.param('userId'))

  if (!followingId) {
    return c.json({success: false, error: 'Invalid userId'}, 400)
  }

  await unfollowUser(followerId, followingId)
  return c.json({success: true})
})

// ═══════════════════════════════════════════
// GET /api/v1/publish/user/:userId — 查看用户公开数据
// ═══════════════════════════════════════════

router.get('/user/:userId', async c => {
  const viewerId = getUserId(c)
  const targetId = parseInt(c.req.param('userId'))

  if (!targetId) {
    return c.json({success: false, error: 'Invalid userId'}, 400)
  }

  // 检查是否已关注（仅当不是自己时）
  let followed = false
  if (targetId !== viewerId) {
    followed = await isFollowing(viewerId, targetId)
  }

  const data = await getPublicUserData(targetId, viewerId)
  if (!data) {
    return c.json({success: false, error: '用户未公开数据或不存在'}, 404)
  }

  return c.json({success: true, data: {...data, followed}})
})

// ═══════════════════════════════════════════
// GET /api/v1/publish/stats — 我的发布统计
// ═══════════════════════════════════════════

router.get('/stats', async c => {
  const userId = getUserId(c)
  const [followerCount, followingCount] = await Promise.all([
    getFollowerCount(userId),
    getFollowingCount(userId)
  ])
  return c.json({
    success: true,
    data: {followerCount, followingCount}
  })
})

export {router as publishRouter}
