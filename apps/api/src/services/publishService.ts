/**
 * 发布订阅服务
 *
 * 职责:
 *   1. 管理用户的发布设置（公开/隐私、粒度等）
 *   2. 管理用户间的关注关系
 *   3. 查询公开用户的仓位/资金数据
 *   4. 仓位变动时推送通知到关注者
 */

import {db} from '../db/index.js'
import {
  publishSettings,
  userFollows,
  users,
  positions,
  trades,
  apiKeys,
  accountSnapshots
} from '../db/schema.js'
import {eq, and, like, desc, inArray, sql, asc} from 'drizzle-orm'
import type {
  PublishSettings,
  PublishSettingsUpdate,
  PublicUser,
  PublicUserData,
  PublicPosition,
  PublicCapital,
  PublicTrade,
  FollowItem,
  PositionGranularity
} from '@nexttrade/shared'

// ─── 默认发布设置 ───

const DEFAULT_SETTINGS: PublishSettings = {
  isPublic: false,
  showPositions: true,
  positionGranularity: 'basic',
  showCapital: false,
  showOrders: false,
  updatedAt: new Date().toISOString()
}

// ═══════════════════════════════════════════
// 1. 发布设置管理
// ═══════════════════════════════════════════

/** 获取用户的发布设置，不存在则创建默认 */
export async function getPublishSettings(
  userId: number
): Promise<PublishSettings> {
  const [row] = await db
    .select()
    .from(publishSettings)
    .where(eq(publishSettings.userId, userId))
    .limit(1)

  if (row) {
    return {
      isPublic: row.isPublic,
      showPositions: row.showPositions,
      positionGranularity: row.positionGranularity as PositionGranularity,
      showCapital: row.showCapital,
      showOrders: row.showOrders,
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString()
    }
  }

  // 不存在则创建默认
  await db
    .insert(publishSettings)
    .values({
      userId,
      isPublic: false,
      showPositions: true,
      positionGranularity: 'basic',
      showCapital: false,
      showOrders: false
    })
    .onConflictDoNothing({target: publishSettings.userId})

  return {...DEFAULT_SETTINGS}
}

/** 更新发布设置 */
export async function updatePublishSettings(
  userId: number,
  data: PublishSettingsUpdate
): Promise<PublishSettings> {
  // 先确保有默认记录
  await getPublishSettings(userId)

  const updateData: Record<string, any> = {updatedAt: new Date()}
  if (data.isPublic !== undefined) updateData.isPublic = data.isPublic
  if (data.showPositions !== undefined)
    updateData.showPositions = data.showPositions
  if (data.positionGranularity !== undefined)
    updateData.positionGranularity = data.positionGranularity
  if (data.showCapital !== undefined) updateData.showCapital = data.showCapital
  if (data.showOrders !== undefined) updateData.showOrders = data.showOrders

  await db
    .update(publishSettings)
    .set(updateData)
    .where(eq(publishSettings.userId, userId))

  return getPublishSettings(userId)
}

// ═══════════════════════════════════════════
// 2. 关注管理
// ═══════════════════════════════════════════

/** 关注用户 */
export async function followUser(
  followerId: number,
  followingId: number
): Promise<void> {
  if (followerId === followingId) {
    throw new Error('不能关注自己')
  }

  await db
    .insert(userFollows)
    .values({followerId, followingId})
    .onConflictDoNothing({
      target: [userFollows.followerId, userFollows.followingId]
    })
}

/** 取消关注 */
export async function unfollowUser(
  followerId: number,
  followingId: number
): Promise<void> {
  await db
    .delete(userFollows)
    .where(
      and(
        eq(userFollows.followerId, followerId),
        eq(userFollows.followingId, followingId)
      )
    )
}

/** 是否已关注 */
export async function isFollowing(
  followerId: number,
  followingId: number
): Promise<boolean> {
  const [row] = await db
    .select({id: userFollows.id})
    .from(userFollows)
    .where(
      and(
        eq(userFollows.followerId, followerId),
        eq(userFollows.followingId, followingId)
      )
    )
    .limit(1)
  return !!row
}

/** 获取我关注的用户列表 */
export async function getMyFollowing(userId: number): Promise<FollowItem[]> {
  const rows = await db
    .select({
      id: userFollows.id,
      followingId: userFollows.followingId,
      username: users.username,
      isPublic: publishSettings.isPublic,
      showPositions: publishSettings.showPositions,
      positionGranularity: publishSettings.positionGranularity,
      showCapital: publishSettings.showCapital,
      showOrders: publishSettings.showOrders,
      updatedAt: publishSettings.updatedAt,
      createdAt: userFollows.createdAt
    })
    .from(userFollows)
    .innerJoin(users, eq(userFollows.followingId, users.id))
    .leftJoin(
      publishSettings,
      eq(userFollows.followingId, publishSettings.userId)
    )
    .where(eq(userFollows.followerId, userId))
    .orderBy(desc(userFollows.createdAt))

  const results: FollowItem[] = []

  for (const row of rows) {
    const settings: PublishSettings = {
      isPublic: row.isPublic ?? false,
      showPositions: row.showPositions ?? true,
      positionGranularity: (row.positionGranularity ??
        'basic') as PositionGranularity,
      showCapital: row.showCapital ?? false,
      showOrders: row.showOrders ?? false,
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString()
    }

    // 获取对方公开持仓数量
    let openCount = 0
    if (settings.isPublic && settings.showPositions) {
      const [cnt] = await db
        .select({count: sql<number>`count(*)::int`})
        .from(positions)
        .innerJoin(apiKeys, eq(positions.apiKeyId, apiKeys.id))
        .innerJoin(users, eq(apiKeys.userId, row.followingId))
        .where(
          and(eq(apiKeys.userId, row.followingId), eq(positions.status, 'OPEN'))
        )
      openCount = cnt?.count ?? 0
    }

    results.push({
      id: row.id,
      followingId: row.followingId,
      username: row.username,
      settings,
      openPositionCount: openCount,
      createdAt: row.createdAt?.toISOString() ?? ''
    })
  }

  return results
}

/** 获取我的粉丝数 */
export async function getFollowerCount(userId: number): Promise<number> {
  const [row] = await db
    .select({count: sql<number>`count(*)::int`})
    .from(userFollows)
    .where(eq(userFollows.followingId, userId))
  return row?.count ?? 0
}

/** 获取关注数 */
export async function getFollowingCount(userId: number): Promise<number> {
  const [row] = await db
    .select({count: sql<number>`count(*)::int`})
    .from(userFollows)
    .where(eq(userFollows.followerId, userId))
  return row?.count ?? 0
}

// ═══════════════════════════════════════════
// 3. 浏览公开用户
// ═══════════════════════════════════════════

/** 搜索公开用户（支持用户名模糊搜索） */
export async function searchPublicUsers(
  currentUserId: number,
  keyword?: string,
  page = 1,
  pageSize = 50
): Promise<{users: PublicUser[]; total: number}> {
  const conditions: any[] = [eq(publishSettings.isPublic, true)]

  // 有关键词时排除自己（避免搜索结果被自己刷屏）
  if (keyword) {
    conditions.push(like(users.username, `%${keyword}%`))
  }

  const where = and(...conditions)

  const [countResult] = await db
    .select({count: sql<number>`count(*)::int`})
    .from(publishSettings)
    .innerJoin(users, eq(publishSettings.userId, users.id))
    .where(where)

  const total = countResult?.count ?? 0
  const offset = (page - 1) * pageSize

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      isPublic: publishSettings.isPublic,
      showPositions: publishSettings.showPositions,
      positionGranularity: publishSettings.positionGranularity,
      showCapital: publishSettings.showCapital,
      showOrders: publishSettings.showOrders,
      updatedAt: publishSettings.updatedAt
    })
    .from(publishSettings)
    .innerJoin(users, eq(publishSettings.userId, users.id))
    .where(where)
    .orderBy(desc(publishSettings.updatedAt))
    .limit(pageSize)
    .offset(offset)

  // 批量查询当前用户是否已关注
  const followingIds = rows.map(r => r.id)
  let followMap = new Map<number, boolean>()

  if (followingIds.length > 0) {
    const follows = await db
      .select({followingId: userFollows.followingId})
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, currentUserId),
          inArray(userFollows.followingId, followingIds)
        )
      )
    followMap = new Map(follows.map(f => [f.followingId, true]))
  }

  const results: PublicUser[] = []

  for (const row of rows) {
    const settings: PublishSettings = {
      isPublic: row.isPublic,
      showPositions: row.showPositions,
      positionGranularity: (row.positionGranularity ??
        'basic') as PositionGranularity,
      showCapital: row.showCapital,
      showOrders: row.showOrders,
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString()
    }

    // 获取公开持仓数量
    let openCount = 0
    if (settings.showPositions) {
      const [cnt] = await db
        .select({count: sql<number>`count(*)::int`})
        .from(positions)
        .innerJoin(apiKeys, eq(positions.apiKeyId, apiKeys.id))
        .where(and(eq(apiKeys.userId, row.id), eq(positions.status, 'OPEN')))
      openCount = cnt?.count ?? 0
    }

    results.push({
      id: row.id,
      username: row.username,
      isFollowing: followMap.has(row.id),
      settings,
      openPositionCount: openCount
    })
  }

  return {users: results, total}
}

// ═══════════════════════════════════════════
// 4. 获取用户公开数据
// ═══════════════════════════════════════════

/** 获取某个用户的公开数据（按需拉取） */
export async function getPublicUserData(
  userId: number,
  viewerId?: number
): Promise<PublicUserData | null> {
  // 验证用户存在
  const [user] = await db
    .select({id: users.id, username: users.username})
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) return null

  const settings = await getPublishSettings(userId)

  // 检查访问权限
  const isOwner = viewerId === userId
  if (!settings.isPublic && !isOwner) {
    return null
  }

  const result: PublicUserData = {
    user: {id: user.id, username: user.username},
    updatedAt: settings.updatedAt
  }

  // 获取公开持仓（对非本人：必须在公开且允许显示持仓时）
  const canSeePositions =
    isOwner || (settings.isPublic && settings.showPositions)
  if (canSeePositions) {
    const userKeys = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))

    if (userKeys.length > 0) {
      const keyIds = userKeys.map(k => k.id)
      const posRows = await db
        .select({
          symbol: positions.symbol,
          positionSide: positions.positionSide,
          entryPrice: positions.entryPrice,
          quantity: positions.quantity,
          realizedPnl: positions.realizedPnl,
          roiPct: positions.roiPct,
          status: positions.status
        })
        .from(positions)
        .where(
          and(inArray(positions.apiKeyId, keyIds), eq(positions.status, 'OPEN'))
        )

      if (settings.positionGranularity === 'basic' && !isOwner) {
        // basic 粒度：只暴露 symbol + 方向 + roi%（不含具体金额）
        result.positions = posRows.map(p => ({
          symbol: p.symbol,
          positionSide: p.positionSide as 'LONG' | 'SHORT',
          entryPrice: 0,
          markPrice: 0,
          unrealizedPnl: 0,
          roiPct: parseFloat(p.roiPct ?? '0'),
          leverage: 0,
          marginType: ''
        }))
      } else {
        // full 粒度：暴露完整数据（或者自己是本人）
        // 获取实时标记价
        result.positions = posRows.map(p => ({
          symbol: p.symbol,
          positionSide: p.positionSide as 'LONG' | 'SHORT',
          entryPrice: parseFloat(p.entryPrice),
          markPrice: 0, // 需要实时价格，简化处理
          unrealizedPnl: parseFloat(p.realizedPnl ?? '0'),
          roiPct: parseFloat(p.roiPct ?? '0'),
          leverage: 0,
          marginType: ''
        }))
      }
    }
  }

  // 获取公开资金概况（对非本人：必须在公开且允许显示资金时）
  const canSeeCapital = isOwner || (settings.isPublic && settings.showCapital)
  if (canSeeCapital) {
    const userKeys = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))

    if (userKeys.length > 0) {
      const keyIds = userKeys.map(k => k.id)
      const [latest] = await db
        .select({
          totalNetVal: accountSnapshots.totalNetVal,
          snapshotAt: accountSnapshots.snapshotAt
        })
        .from(accountSnapshots)
        .where(inArray(accountSnapshots.apiKeyId, keyIds))
        .orderBy(desc(accountSnapshots.snapshotAt))
        .limit(1)

      if (latest) {
        result.capital = {
          totalNetVal: parseFloat(latest.totalNetVal),
          dayPnl: 0,
          dayPnlPct: 0,
          snapshotAt: latest.snapshotAt?.toISOString() ?? null
        }
      }
    }
  }

  // 获取公开订单历史（最近20条，对非本人：必须在公开且允许显示订单时）
  const canSeeOrders = isOwner || (settings.isPublic && settings.showOrders)
  if (canSeeOrders) {
    const userKeys = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))

    if (userKeys.length > 0) {
      const keyIds = userKeys.map(k => k.id)
      const tradeRows = await db
        .select({
          tradeId: trades.tradeId,
          symbol: trades.symbol,
          side: trades.side,
          price: trades.price,
          amount: trades.amount,
          realizedPnl: trades.realizedPnl,
          executedAt: trades.executedAt
        })
        .from(trades)
        .where(inArray(trades.apiKeyId, keyIds))
        .orderBy(desc(trades.executedAt))
        .limit(20)

      if (tradeRows.length > 0) {
        result.trades = tradeRows.map(t => ({
          tradeId: t.tradeId,
          symbol: t.symbol,
          side: t.side,
          price: parseFloat(t.price),
          amount: parseFloat(t.amount),
          realizedPnl: parseFloat(t.realizedPnl ?? '0'),
          executedAt: t.executedAt?.toISOString() ?? ''
        }))
      }
    }
  }

  return result
}
