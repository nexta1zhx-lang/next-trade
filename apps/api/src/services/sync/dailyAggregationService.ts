/**
 * 每日资产快照聚合服务
 *
 * 功能: 从 account_snapshots（5min 快照）中提取每日 UTC 00:00 附近的最新一条记录，
 *       写入 asset_snapshots（日级归档）供 NAV 计算使用。
 *
 * 调度频率: 每天 UTC 00:01（北京时间 08:01）执行一次
 *
 * 防坑要点:
 *   - 取 UTC 00:00 ± 2 小时范围内最新的一条快照，而非硬取 00:00:00 整点
 *   - 若当天已有日级记录则跳过（幂等）
 */

import {db} from '../../db/index.js'
import {apiKeys, accountSnapshots, assetSnapshots} from '../../db/schema.js'
import {eq, and, sql} from 'drizzle-orm'

export interface DailyAggregationResult {
  apiKeyId: number
  success: boolean
  snapDate: string
  totalEquity: string | null
  error?: string
}

/**
 * 对单个 API Key 执行日级快照聚合
 * 查找 UTC 00:00 前后 2 小时内最新的一条 5min 快照
 */
export async function aggregateDailySnapshot(
  apiKeyId: number,
  /** 目标日期 YYYY-MM-DD (UTC) */
  targetDate: string
): Promise<DailyAggregationResult> {
  try {
    // 1. 检查是否已有日级记录（幂等）
    const existing = await db
      .select({id: assetSnapshots.id})
      .from(assetSnapshots)
      .where(
        and(
          eq(assetSnapshots.apiKeyId, apiKeyId),
          eq(assetSnapshots.snapDate, targetDate)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      return {
        apiKeyId,
        success: true,
        snapDate: targetDate,
        totalEquity: null,
        error: 'Already exists, skipped'
      }
    }

    // 2. 计算 UTC 00:00 的时间范围: [前日 22:00, 当日 02:00]
    // targetDate = "2026-07-20", UTC 00:00 = "2026-07-20T00:00:00Z"
    // 窗口: 前 2h ~ 后 2h → "2026-07-19T22:00:00Z" ~ "2026-07-20T02:00:00Z"
    const utcMidnight = new Date(targetDate + 'T00:00:00Z')
    const windowStart = new Date(
      utcMidnight.getTime() - 2 * 60 * 60 * 1000
    ).toISOString()
    const windowEnd = new Date(
      utcMidnight.getTime() + 2 * 60 * 60 * 1000
    ).toISOString()

    // 3. 查找时间窗口内最新的一条快照
    const [snap] = await db
      .select({
        totalNetValue: accountSnapshots.totalNetValue,
        spotBalance: accountSnapshots.spotBalance,
        contractEquity: accountSnapshots.contractEquity,
        unrealizedPnl: accountSnapshots.unrealizedPnl,
        snapshotAt: accountSnapshots.snapshotAt
      })
      .from(accountSnapshots)
      .where(
        and(
          eq(accountSnapshots.apiKeyId, apiKeyId),
          sql`${accountSnapshots.snapshotAt} >= ${windowStart}::timestamptz`,
          sql`${accountSnapshots.snapshotAt} <= ${windowEnd}::timestamptz`
        )
      )
      .orderBy(sql`${accountSnapshots.snapshotAt} DESC`)
      .limit(1)

    if (!snap) {
      // 窗口内无数据，取当天最早的一条
      const dayStart = `${targetDate}T00:00:00.000Z`
      const dayEnd = `${targetDate}T23:59:59.999Z`
      const [fallbackSnap] = await db
        .select({
          totalNetValue: accountSnapshots.totalNetValue,
          spotBalance: accountSnapshots.spotBalance,
          contractEquity: accountSnapshots.contractEquity,
          unrealizedPnl: accountSnapshots.unrealizedPnl,
          snapshotAt: accountSnapshots.snapshotAt
        })
        .from(accountSnapshots)
        .where(
          and(
            eq(accountSnapshots.apiKeyId, apiKeyId),
            sql`${accountSnapshots.snapshotAt} >= ${dayStart}::timestamptz`,
            sql`${accountSnapshots.snapshotAt} <= ${dayEnd}::timestamptz`
          )
        )
        .orderBy(sql`${accountSnapshots.snapshotAt} ASC`)
        .limit(1)

      if (!fallbackSnap) {
        return {
          apiKeyId,
          success: false,
          snapDate: targetDate,
          totalEquity: null,
          error: 'No snapshot found for this date'
        }
      }

      // 用当天最早一条写入
      await db.insert(assetSnapshots).values({
        apiKeyId,
        snapDate: targetDate,
        totalEquity: fallbackSnap.totalNetValue,
        spotValue: fallbackSnap.spotBalance,
        contractEquity: fallbackSnap.contractEquity,
        unrealizedPnl: fallbackSnap.unrealizedPnl,
        snapshotAt: fallbackSnap.snapshotAt,
        isReconstructed: false
      })

      return {
        apiKeyId,
        success: true,
        snapDate: targetDate,
        totalEquity: fallbackSnap.totalNetValue
      }
    }

    // 4. 写入日级归档
    await db.insert(assetSnapshots).values({
      apiKeyId,
      snapDate: targetDate,
      totalEquity: snap.totalNetValue,
      spotValue: snap.spotBalance,
      contractEquity: snap.contractEquity,
      unrealizedPnl: snap.unrealizedPnl,
      snapshotAt: snap.snapshotAt,
      isReconstructed: false
    })

    return {
      apiKeyId,
      success: true,
      snapDate: targetDate,
      totalEquity: snap.totalNetValue
    }
  } catch (err: any) {
    return {
      apiKeyId,
      success: false,
      snapDate: targetDate,
      totalEquity: null,
      error: err.message?.slice(0, 200) ?? 'Unknown error'
    }
  }
}

/**
 * 对所有 ACTIVE 状态的 Key 执行日级聚合
 * @param targetDate 目标日期，默认昨天（UTC）
 */
export async function aggregateAllDailySnapshots(
  targetDate?: string
): Promise<DailyAggregationResult[]> {
  const date = targetDate ?? getYesterdayUTC()
  console.log(`[DailyAggregation] Starting aggregation for ${date}`)

  const activeKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(eq(apiKeys.status, 'ACTIVE'))

  if (activeKeys.length === 0) {
    console.log('[DailyAggregation] No active keys found')
    return []
  }

  const results: DailyAggregationResult[] = []
  for (const key of activeKeys) {
    const result = await aggregateDailySnapshot(key.id, date)
    results.push(result)
  }

  const successCount = results.filter(r => r.success).length
  const newCount = results.filter(r => r.totalEquity !== null).length
  const skipCount = results.filter(
    r => r.totalEquity === null && r.success
  ).length
  const failCount = results.filter(r => !r.success).length

  console.log(
    `[DailyAggregation] ${date}: ${successCount} ok (${newCount} new, ${skipCount} skipped)${failCount > 0 ? `, ${failCount} failed` : ''}`
  )

  return results
}

function getYesterdayUTC(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
