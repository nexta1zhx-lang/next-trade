/**
 * 资金曲线分析服务 (增强版)
 *
 * 采用币安官方 NAV（单位净值）算法:
 *   1. 每日 UTC 00:00 资产快照 asset_snapshots → E_t
 *   2. 出入金流水 capital_flows → NetFlow_t / InFlow_t
 *   3. 日收益率 R_t = (E_t - E_{t-1} - NetFlow_t) / (E_{t-1} + InFlow_t)
 *   4. NAV_t = NAV_{t-1} × (1 + R_t) 初始 NAV_0 = 1.00
 *   5. DailyPnL_t = E_t - E_{t-1} - NetFlow_t
 *
 * 增强特性:
 *   - Redis 缓存（TTL 3600s，capital_flow 变更时失效）
 *   - 衍生指标: Sharpe Ratio, Calmar Ratio, 胜率, 盈亏比
 */

import {db} from '../../db/index.js'
import {
  trades,
  apiKeys,
  assetSnapshots,
  capitalFlows,
  accountSnapshots
} from '../../db/schema.js'
import {eq, and, sql, desc} from 'drizzle-orm'
import type {
  EquityCurveData,
  EquityPoint,
  EquityPerformanceMetrics
} from '@nexttrade/shared'
import {redis} from '../redis.js'
import Decimal from 'decimal.js'

// ─── 常量 ───
const RISK_FREE_RATE = 0.04 // 年化无风险利率 4%
const CACHE_TTL = 3600 // Redis 缓存 TTL (秒)
const CACHE_PREFIX = 'equity:curve:'

export interface EquityQuery {
  userId: number
  keyId?: number
  startDate: string
  endDate: string
}

/**
 * 生成缓存 Key
 */
function cacheKey(query: EquityQuery): string {
  return `${CACHE_PREFIX}${query.userId}:${query.keyId ?? 'all'}:${query.startDate}:${query.endDate}`
}

/**
 * 计算资金曲线（带 Redis 缓存）
 */
export async function computeEquityCurve(
  query: EquityQuery
): Promise<EquityCurveData> {
  // ─── 1. 尝试 Redis 缓存 ───
  const cKey = cacheKey(query)
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(cKey)
      if (cached) {
        const parsed = JSON.parse(cached) as EquityCurveData
        // 跳过无效缓存（全零数据，由之前的 bug 产生）
        if (
          parsed.currentNetValue <= 0 ||
          parsed.points.every(p => p.netValue === 0)
        ) {
          await redis.del(cKey)
        } else {
          // 缓存有效条件:
          //   - 查询的历史区间已结束 (endDate < today) → 历史数据不变，直接返回
          //   - 或缓存仍在 TTL 有效期内
          const today = new Date().toISOString().slice(0, 10)
          const isHistorical = parsed.endDate < today
          const isFresh =
            parsed.cachedAt && Date.now() - parsed.cachedAt < CACHE_TTL * 1000
          if (isHistorical || isFresh) {
            return parsed
          }
        }
      }
    } catch {
      // 缓存读取失败，回退 DB 查询
    }
  }

  // ─── 2. DB 查询 ───
  const data = await computeFromDb(query)

  // ─── 3. 写入 Redis 缓存（仅缓存有效数据） ───
  if (
    redis.status === 'ready' &&
    data.currentNetValue > 0 &&
    data.points.length > 0
  ) {
    try {
      const toCache = {...data, cachedAt: Date.now()}
      await redis.set(cKey, JSON.stringify(toCache), 'EX', CACHE_TTL)
    } catch {
      // 缓存写入失败不影响返回
    }
  }

  return data
}

/**
 * 失效指定用户的资金曲线缓存
 * 在新增 capital_flow 或日级快照聚合后调用
 */
export async function invalidateEquityCache(userId: number): Promise<void> {
  if (redis.status !== 'ready') return
  try {
    // 扫描并删除该用户的所有 equity 缓存
    const pattern = `${CACHE_PREFIX}${userId}:*`
    let cursor = '0'
    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 50)
      cursor = result[0]
      const keys = result[1]
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } while (cursor !== '0')
  } catch {
    // 静默失败
  }
}

/**
 * 从 DB 计算资金曲线（无缓存）
 */
async function computeFromDb(query: EquityQuery): Promise<EquityCurveData> {
  const {userId, keyId, startDate, endDate} = query

  const userKeys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))

  if (userKeys.length === 0) {
    return emptyCurve(startDate, endDate)
  }

  const allowedKeyIds = keyId ? [keyId] : userKeys.map(k => k.id)
  const startStr = `${startDate}T00:00:00.000Z`
  const endStr = `${endDate}T23:59:59.999Z`

  // ─── 1. 每日资产快照 ───
  const snapRows = await db
    .select({
      snapDate: assetSnapshots.snapDate,
      totalEquity: sql<string>`${assetSnapshots.totalEquity}::numeric`,
      snapshotAt: assetSnapshots.snapshotAt
    })
    .from(assetSnapshots)
    .where(
      and(
        sql`${assetSnapshots.apiKeyId} = ANY(ARRAY[${sql.join(allowedKeyIds, sql`, `)}]::int[])`,
        sql`${assetSnapshots.snapDate} >= ${startDate}`,
        sql`${assetSnapshots.snapDate} <= ${endDate}`
      )
    )
    .orderBy(desc(assetSnapshots.snapDate))

  const equityByDate = new Map<string, Decimal>()
  for (const r of snapRows) {
    if (!equityByDate.has(r.snapDate)) {
      equityByDate.set(r.snapDate, new Decimal(r.totalEquity))
    }
  }

  // ─── 2. 出入金流水 ───
  const flowRows = await db
    .select({
      flowDate: capitalFlows.flowDate,
      flowType: capitalFlows.flowType,
      amount: sql<string>`${capitalFlows.amount}::numeric`
    })
    .from(capitalFlows)
    .where(
      and(
        sql`${capitalFlows.apiKeyId} = ANY(ARRAY[${sql.join(allowedKeyIds, sql`, `)}]::int[])`,
        sql`${capitalFlows.flowDate} >= ${startDate}`,
        sql`${capitalFlows.flowDate} <= ${endDate}`
      )
    )

  const netFlowByDate = new Map<string, Decimal>()
  const inFlowByDate = new Map<string, Decimal>()
  for (const r of flowRows) {
    const amt = new Decimal(r.amount)
    const curNet = netFlowByDate.get(r.flowDate) ?? new Decimal(0)
    const curIn = inFlowByDate.get(r.flowDate) ?? new Decimal(0)

    if (r.flowType === 'deposit' || r.flowType === 'transfer_in') {
      netFlowByDate.set(r.flowDate, curNet.add(amt))
      inFlowByDate.set(r.flowDate, curIn.add(amt))
    } else {
      netFlowByDate.set(r.flowDate, curNet.sub(amt))
    }
  }

  // ─── 3. 5分钟快照（无日快照时兜底） ───
  const intradayRows = await db
    .select({
      snapshotAt: accountSnapshots.snapshotAt,
      totalNetValue: sql<string>`${accountSnapshots.totalNetValue}::numeric`
    })
    .from(accountSnapshots)
    .where(
      and(
        sql`${accountSnapshots.apiKeyId} = ANY(ARRAY[${sql.join(allowedKeyIds, sql`, `)}]::int[])`,
        sql`${accountSnapshots.snapshotAt} >= ${startStr}::timestamptz`,
        sql`${accountSnapshots.snapshotAt} <= ${endStr}::timestamptz`
      )
    )
    .orderBy(desc(accountSnapshots.snapshotAt))

  const snap5mByDate = new Map<string, Decimal>()
  for (const s of intradayRows) {
    const date = new Date(s.snapshotAt).toISOString().slice(0, 10)
    if (!snap5mByDate.has(date)) {
      snap5mByDate.set(date, new Decimal(s.totalNetValue))
    }
  }

  // ─── 4. 兜底: 成交盈亏 ───
  const tradeRows = await db
    .select({
      date: sql<string>`to_char(${trades.executedAt}, 'YYYY-MM-DD')`,
      dailyPnl: sql<string>`coalesce(sum(${trades.realizedPnl}::numeric), 0)`
    })
    .from(trades)
    .where(
      and(
        sql`${trades.apiKeyId} = ANY(ARRAY[${sql.join(allowedKeyIds, sql`, `)}]::int[])`,
        sql`${trades.executedAt} >= ${startStr}::timestamptz`,
        sql`${trades.executedAt} <= ${endStr}::timestamptz`
      )
    )
    .groupBy(sql`to_char(${trades.executedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${trades.executedAt}, 'YYYY-MM-DD')`)

  const tradePnlByDate = new Map<string, Decimal>()
  for (const r of tradeRows) {
    tradePnlByDate.set(r.date, new Decimal(r.dailyPnl))
  }

  // ═══════════════════════════════════════
  // NAV 计算
  // ═══════════════════════════════════════
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T23:59:59.999Z`)

  let prevEquity: Decimal | null = null
  let nav = new Decimal(1)
  let peakNav = new Decimal(1)
  let maxDrawdown = new Decimal(0)
  let peakNavDate: string | null = null
  let currentDrawdownStart: string | null = null
  let maxDrawdownDays = 0
  let currentDrawdownDays = 0
  const points: EquityPoint[] = []

  const current = new Date(start)
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10)

    // 权益优先级: 日快照 > 5分钟快照
    let equity: Decimal | null = equityByDate.get(dateStr) ?? null
    if (!equity) equity = snap5mByDate.get(dateStr) ?? null

    const dailyPnlTrade = tradePnlByDate.get(dateStr) ?? new Decimal(0)
    const netFlow = netFlowByDate.get(dateStr) ?? new Decimal(0)
    const inFlow = inFlowByDate.get(dateStr) ?? new Decimal(0)

    // ─── 锚点查找：跳过开头无数据的日期 ───
    if (prevEquity === null) {
      if (equity && equity.gt(0)) {
        // 找到第一个有快照的日期，以此作为锚点，NAV=1.0
        prevEquity = equity
        points.push({
          date: dateStr,
          netValue: equity.toNumber(),
          cumulativeReturn: 0,
          dailyPnl: 0,
          drawdown: 0,
          cumulativePnl: 0
        })
        current.setUTCDate(current.getUTCDate() + 1)
        continue
      }
      if (dailyPnlTrade.gt(0)) {
        // 有成交盈亏，用成交金额*2+100 估算锚点 equity
        const estEquity = dailyPnlTrade.mul(2).abs().add(100)
        prevEquity = estEquity
        points.push({
          date: dateStr,
          netValue: estEquity.toNumber(),
          cumulativeReturn: 0,
          dailyPnl: dailyPnlTrade.toNumber(),
          drawdown: 0,
          cumulativePnl: 0
        })
        current.setUTCDate(current.getUTCDate() + 1)
        continue
      }
      // 无任何数据，跳过这一天
      current.setUTCDate(current.getUTCDate() + 1)
      continue
    }

    // ─── 已有锚点后的正常 NAV 推演 ───
    let dailyPnl: Decimal
    let netValue: Decimal

    if (equity && equity.gt(0)) {
      // 有权益快照
      const denominator = prevEquity.add(inFlow)
      const dailyReturn = denominator.gt(0)
        ? equity.sub(prevEquity).sub(netFlow).div(denominator)
        : new Decimal(0)
      nav = nav.mul(new Decimal(1).add(dailyReturn))
      dailyPnl = equity.sub(prevEquity).sub(netFlow)
      netValue = equity
      prevEquity = equity
    } else {
      // 无快照: 成交推算（若无成交数据则平滑延续前值）
      const prevEq = prevEquity as Decimal
      const hasTradeOrFlow =
        dailyPnlTrade.gt(0) || !netFlow.isZero() || !inFlow.isZero()
      if (hasTradeOrFlow) {
        const est: Decimal = prevEq.add(dailyPnlTrade).sub(netFlow)
        const denom = prevEq.add(inFlow)
        const dailyReturn = denom.gt(0)
          ? est.sub(prevEq).sub(netFlow).div(denom)
          : new Decimal(0)
        nav = nav.mul(new Decimal(1).add(dailyReturn))
        dailyPnl = dailyPnlTrade
        netValue = est
        prevEquity = est
      } else {
        // 无任何变动：延续前一天净值
        dailyPnl = new Decimal(0)
        netValue = prevEq
        // NAV 不变
      }
    }

    // 回撤追踪
    if (nav.gt(peakNav)) {
      peakNav = nav
      peakNavDate = dateStr
      currentDrawdownStart = null
    } else {
      if (!currentDrawdownStart) currentDrawdownStart = dateStr
      currentDrawdownDays = dateDiff(currentDrawdownStart, dateStr)
      if (currentDrawdownDays > maxDrawdownDays) {
        maxDrawdownDays = currentDrawdownDays
      }
    }

    const drawdownPct = peakNav.gt(0)
      ? peakNav.sub(nav).div(peakNav).mul(100)
      : new Decimal(0)
    if (drawdownPct.gt(maxDrawdown)) maxDrawdown = drawdownPct

    const cumulativeReturn = nav.sub(1).mul(100)

    points.push({
      date: dateStr,
      netValue: netValue.toNumber(),
      cumulativeReturn: cumulativeReturn.toNumber(),
      dailyPnl: dailyPnl.toNumber(),
      drawdown: drawdownPct.toNumber(),
      cumulativePnl: netValue
        .sub(points.length > 0 ? points[0].netValue : netValue)
        .toNumber()
    })

    current.setUTCDate(current.getUTCDate() + 1)
  }

  const initialCapital = points.length > 0 ? points[0].netValue : 0
  const finalNav =
    points.length > 0 ? points[points.length - 1].cumulativeReturn / 100 + 1 : 1

  // ═══════════════════════════════════════
  // 衍生指标计算
  // ═══════════════════════════════════════
  const metrics = computeMetrics(points, initialCapital)

  // 确定数据来源
  const hasDailySnapshot = snapRows.length > 0
  const source: 'snapshot' | 'trade' = hasDailySnapshot ? 'snapshot' : 'trade'

  return {
    startDate,
    endDate,
    initialCapital,
    currentNetValue: points.length > 0 ? points[points.length - 1].netValue : 0,
    totalReturn:
      points.length > 0 ? points[points.length - 1].cumulativeReturn : 0,
    maxDrawdown: maxDrawdown.toNumber(),
    metrics,
    points,
    source
  }
}

/**
 * 计算性能衍生指标
 */
function computeMetrics(
  points: EquityPoint[],
  initialCapital: number
): EquityPerformanceMetrics {
  if (points.length < 2) {
    return {
      sharpeRatio: 0,
      calmarRatio: 0,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      winRate: 0,
      profitLossRatio: 0,
      winDays: 0,
      lossDays: 0,
      avgDailyPnl: 0,
      maxDailyWin: 0,
      maxDailyLoss: 0,
      drawdownDays: 0,
      recoveryDays: 0
    }
  }

  // 日收益率序列（从第 2 天开始，因为第 1 天 dailyReturn=0）
  const dailyReturns = points
    .slice(1)
    .map(p => p.dailyPnl / (p.netValue - p.dailyPnl || 1))

  const n = dailyReturns.length
  if (n === 0) {
    return {
      sharpeRatio: 0,
      calmarRatio: 0,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      winRate: 0,
      profitLossRatio: 0,
      winDays: 0,
      lossDays: 0,
      avgDailyPnl: 0,
      maxDailyWin: 0,
      maxDailyLoss: 0,
      drawdownDays: 0,
      recoveryDays: 0
    }
  }

  // 平均日收益率
  const sum = dailyReturns.reduce((a, b) => a + b, 0)
  const meanDailyReturn = sum / n

  // 日收益率标准差
  const variance =
    dailyReturns.reduce((acc, r) => acc + (r - meanDailyReturn) ** 2, 0) / n
  const stdDailyReturn = Math.sqrt(variance)

  // 年化收益率 (252 个交易日)
  const annualizedReturn = (Math.pow(1 + meanDailyReturn, 252) - 1) * 100

  // 年化波动率
  const annualizedVolatility = stdDailyReturn * Math.sqrt(252) * 100

  // 夏普比率 (年化)
  const sharpeRatio =
    stdDailyReturn > 0
      ? (meanDailyReturn * 252 - RISK_FREE_RATE) /
        (stdDailyReturn * Math.sqrt(252))
      : 0

  // 最大回撤 (已经计算过，从 points 中取)
  const maxDD = Math.max(...points.map(p => p.drawdown))

  // 卡尔玛比率
  const calmarRatio = maxDD > 0 ? annualizedReturn / maxDD : 0

  // 胜率 & 盈亏比
  const winDays = points.filter(p => p.dailyPnl > 0).length
  const lossDays = points.filter(p => p.dailyPnl < 0).length
  const total = points.length
  const winRate = total > 0 ? (winDays / total) * 100 : 0

  const totalWin = points
    .filter(p => p.dailyPnl > 0)
    .reduce((s, p) => s + p.dailyPnl, 0)
  const totalLoss = Math.abs(
    points.filter(p => p.dailyPnl < 0).reduce((s, p) => s + p.dailyPnl, 0)
  )
  const profitLossRatio =
    totalLoss > 0 ? totalWin / winDays / (totalLoss / lossDays) : 0

  // 日均盈亏
  const totalPnl = points.reduce((s, p) => s + p.dailyPnl, 0)
  const avgDailyPnl = total / totalPnl || 0

  // 最大单日盈亏
  const maxDailyWin = Math.max(...points.map(p => p.dailyPnl), 0)
  const maxDailyLoss = Math.min(...points.map(p => p.dailyPnl), 0)

  // 回撤天数 & 恢复天数
  let drawdownDays = 0
  let recoveryDays = 0
  let inDrawdown = false
  let ddStartIdx = -1
  for (let i = 0; i < points.length; i++) {
    if (points[i].drawdown > 0.01) {
      if (!inDrawdown) {
        inDrawdown = true
        ddStartIdx = i
      }
      drawdownDays++
    } else {
      if (inDrawdown) {
        recoveryDays = i - ddStartIdx
        inDrawdown = false
      }
    }
  }

  return {
    sharpeRatio: Number(sharpeRatio.toFixed(4)),
    calmarRatio: Number(calmarRatio.toFixed(4)),
    annualizedReturn: Number(annualizedReturn.toFixed(2)),
    annualizedVolatility: Number(annualizedVolatility.toFixed(2)),
    winRate: Number(winRate.toFixed(2)),
    profitLossRatio: Number(profitLossRatio.toFixed(2)),
    winDays,
    lossDays,
    avgDailyPnl: Number(avgDailyPnl.toFixed(2)),
    maxDailyWin: Number(maxDailyWin.toFixed(2)),
    maxDailyLoss: Number(maxDailyLoss.toFixed(2)),
    drawdownDays,
    recoveryDays
  }
}

function dateDiff(start: string, end: string): number {
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  return Math.max(0, Math.round((e - s) / (24 * 60 * 60 * 1000)))
}

function emptyCurve(startDate: string, endDate: string): EquityCurveData {
  return {
    startDate,
    endDate,
    initialCapital: 0,
    currentNetValue: 0,
    totalReturn: 0,
    maxDrawdown: 0,
    points: []
  }
}
