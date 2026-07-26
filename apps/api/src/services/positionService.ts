/**
 * 合约仓位服务 — 原生 fetch + HMAC，无 SDK 依赖
 *
 * 职责:
 *   1. 获取当前实时持仓（GET /fapi/v2/account）
 *   2. 从 trades 表匹配开平仓记录构建历史仓位
 *   3. 提供仓位详情（含关联订单和分析指标）
 */

import crypto from 'crypto'
import {db} from '../db/index.js'
import {positions, trades, apiKeys} from '../db/schema.js'
import {eq, and, desc, asc, inArray, sql} from 'drizzle-orm'
import {decrypt} from './crypto.js'
import type {
  OpenPosition,
  PositionRecord,
  PositionDetail,
  PositionSide,
  PositionSummary
} from '@nexttrade/shared'

// ─── 工具函数 ───

function formatHoldingTime(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (hours < 24) return `${hours}小时${mins}分`
  const days = Math.floor(hours / 24)
  const remainHours = hours % 24
  return `${days}天${remainHours}小时${mins}分`
}

function calcROI(
  entryPrice: number,
  exitPrice: number,
  side: PositionSide
): number {
  if (entryPrice === 0) return 0
  const raw = ((exitPrice - entryPrice) / entryPrice) * 100
  return side === 'LONG' ? raw : -raw
}

function calcMaxDrawdown(prices: number[]): number {
  if (prices.length < 2) return 0
  let peak = prices[0]
  let maxDd = 0
  for (const p of prices) {
    if (p > peak) peak = p
    const dd = ((peak - p) / peak) * 100
    if (dd > maxDd) maxDd = dd
  }
  return maxDd
}

// ─── 原生 HTAMC 签名 GET ───

function sign(secret: string, qs: string): string {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex')
}

async function signedGet(
  apiKey: string,
  secret: string,
  path: string,
  params: Record<string, unknown> = {}
): Promise<any> {
  const qsParts = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qsParts.set(k, String(v))
  qsParts.set('recvWindow', '60000')
  qsParts.set('timestamp', String(Date.now()))
  const qs = qsParts.toString()
  const signature = sign(secret, qs)
  const res = await fetch(
    `https://fapi.binance.com${path}?${qs}&signature=${signature}`,
    {
      headers: {'X-MBX-APIKEY': apiKey}
    }
  )
  if (!res.ok)
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function getKey(
  apiKeyId: number
): Promise<{apiKey: string; secret: string}> {
  const [key] = await db
    .select({apiKey: apiKeys.apiKey, secretEnc: apiKeys.secretEnc})
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error(`API Key not found: ${apiKeyId}`)
  return {apiKey: key.apiKey, secret: decrypt(key.secretEnc)}
}

// ═══════════════════════════════════════════
// 1. 获取实时持仓
// ═══════════════════════════════════════════

export async function getOpenPositionsFromExchange(
  apiKeyId: number
): Promise<OpenPosition[]> {
  const {apiKey, secret} = await getKey(apiKeyId)
  const raw = await signedGet(apiKey, secret, '/fapi/v2/account')
  const data: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.positions)
      ? raw.positions
      : []

  return data
    .filter((p: any) => parseFloat(p.positionAmt) !== 0)
    .map(
      (p: any): OpenPosition => ({
        symbol: p.symbol,
        positionSide: (p.positionSide === 'SHORT'
          ? 'SHORT'
          : 'LONG') as PositionSide,
        quantity: Math.abs(parseFloat(p.positionAmt)),
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        liquidationPrice: parseFloat(p.liquidationPrice),
        leverage: parseInt(p.leverage, 10),
        marginType: p.marginType === 'isolated' ? 'isolated' : 'cross',
        unrealizedPnl: parseFloat(p.unRealizedProfit),
        notional: parseFloat(p.notional),
        updateTime: Number(p.updateTime)
      })
    )
    .filter(p => p.quantity > 0)
}

// ═══════════════════════════════════════════
// 2. 从 trades 表匹配构建历史仓位
// ═══════════════════════════════════════════

interface TradeRow {
  id: number
  tradeId: string
  symbol: string
  marketType: string
  side: string
  price: string
  amount: string
  quoteQty: string
  realizedPnl: string | null
  feeUsdt: string | null
  isLiquidation: boolean | null
  executedAt: Date
}

interface PositionBuild {
  symbol: string
  positionSide: PositionSide
  entryPrice: number
  quantity: number // 当前剩余
  totalQty: number // 总开仓量
  realizedPnl: number
  totalFee: number
  entryTradeIds: number[]
  exitTradeIds: number[]
  openedAt: Date
  closedAt: Date | null
  isLiquidation: boolean
  /** 持仓期间价格序列（用于计算回撤） */
  priceHistory: number[]
}

/**
 * 匹配开平仓记录 → 写入 positions 表
 * 对指定 apiKeyId 的所有 PERP 成交进行匹配
 */
export async function syncPositionsFromTrades(apiKeyId: number): Promise<void> {
  // 读取该 Key 的所有合约成交（按时间升序）
  const tradeRows = await db
    .select({
      id: trades.id,
      tradeId: trades.tradeId,
      symbol: trades.symbol,
      marketType: trades.marketType,
      side: trades.side,
      price: trades.price,
      amount: trades.amount,
      quoteQty: trades.quoteQty,
      realizedPnl: trades.realizedPnl,
      feeUsdt: trades.feeUsdt,
      isLiquidation: trades.isLiquidation,
      executedAt: trades.executedAt
    })
    .from(trades)
    .where(
      and(
        eq(trades.apiKeyId, apiKeyId),
        eq(trades.marketType, 'PERP'),
        sql`${trades.side} IN ('OPEN_LONG','CLOSE_LONG','OPEN_SHORT','CLOSE_SHORT')`
      )
    )
    .orderBy(asc(trades.executedAt))

  if (tradeRows.length === 0) return

  // 按 (symbol, direction) 分组
  const groups = new Map<string, TradeRow[]>()
  for (const t of tradeRows) {
    const direction =
      t.side === 'OPEN_LONG' || t.side === 'CLOSE_LONG' ? 'LONG' : 'SHORT'
    const key = `${t.symbol}::${direction}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  const builtPositions: PositionBuild[] = []

  for (const [, groupTrades] of groups) {
    const first = groupTrades[0]
    const direction =
      first.side === 'OPEN_LONG' || first.side === 'CLOSE_LONG'
        ? 'LONG'
        : 'SHORT'
    const sym = first.symbol

    // 当前正在构建的持仓
    let current: PositionBuild | null = null

    for (const t of groupTrades) {
      const price = parseFloat(t.price)
      const amount = parseFloat(t.amount)
      const isOpen = t.side === 'OPEN_LONG' || t.side === 'OPEN_SHORT'
      const realizedPnl = parseFloat(t.realizedPnl ?? '0')
      const fee = parseFloat(t.feeUsdt ?? '0')

      if (isOpen) {
        // ── 开仓 ──
        if (current && current.quantity > 0) {
          // 已有持仓 → 合并（加权均价）
          const totalQty = current.quantity + amount
          current.entryPrice =
            (current.entryPrice * current.quantity + price * amount) / totalQty
          current.quantity = totalQty
          current.totalQty += amount
          current.entryTradeIds.push(t.id)
          current.priceHistory.push(price)
        } else {
          // 新开仓
          current = {
            symbol: sym,
            positionSide: direction,
            entryPrice: price,
            quantity: amount,
            totalQty: amount,
            realizedPnl: 0,
            totalFee: 0,
            entryTradeIds: [t.id],
            exitTradeIds: [],
            openedAt: t.executedAt,
            closedAt: null,
            isLiquidation: false,
            priceHistory: [price]
          }
        }
        // 开仓产生的手续费
        if (current) current.totalFee += fee
      } else {
        // ── 平仓 ──
        if (!current || current.quantity <= 0) {
          // 没有持仓却有平仓 → 跳过（已平完的残余成交）
          continue
        }

        const closeQty = Math.min(amount, current.quantity)
        current.quantity -= closeQty
        current.exitTradeIds.push(t.id)
        current.realizedPnl += realizedPnl
        current.totalFee += fee
        current.priceHistory.push(price)

        if (t.isLiquidation) current.isLiquidation = true

        // 仓位完全平掉 → 归档
        if (current.quantity <= 0) {
          current.closedAt = t.executedAt
          builtPositions.push(current)
          current = null
        }
      }
    }

    // 处理仍未平完的持仓
    if (current && current.quantity > 0) {
      // 只有有开仓记录的才写入
      if (current.entryTradeIds.length > 0) {
        builtPositions.push(current)
      }
    }
  }

  if (builtPositions.length === 0) return

  // ── 写入 positions 表 ──
  for (const bp of builtPositions) {
    const holdingSecs = bp.closedAt
      ? Math.floor((bp.closedAt.getTime() - bp.openedAt.getTime()) / 1000)
      : null

    // 计算收益率: ROI = realizedPnl / (entryPrice * totalQty) * 100
    const cost = bp.entryPrice * bp.totalQty
    const roiPct = cost > 0 ? (bp.realizedPnl / cost) * 100 : 0

    // 计算回撤: 基于 priceHistory
    const ddPct =
      bp.priceHistory.length > 1 ? calcMaxDrawdown(bp.priceHistory) : null

    await db
      .insert(positions)
      .values({
        apiKeyId,
        symbol: bp.symbol,
        positionSide: bp.positionSide,
        status: bp.closedAt ? 'CLOSED' : 'OPEN',
        entryPrice: String(bp.entryPrice),
        exitPrice:
          bp.closedAt && bp.exitTradeIds.length > 0
            ? String(bp.priceHistory[bp.priceHistory.length - 1])
            : null,
        quantity: String(bp.totalQty),
        realizedPnl: String(bp.realizedPnl),
        totalFee: String(bp.totalFee),
        roiPct: String(roiPct),
        maxDrawdownPct: ddPct !== null ? String(ddPct) : null,
        holdingSeconds: holdingSecs,
        isLiquidation: bp.isLiquidation,
        entryTradeIds: JSON.stringify(bp.entryTradeIds),
        exitTradeIds: JSON.stringify(bp.exitTradeIds),
        openedAt: bp.openedAt,
        closedAt: bp.closedAt
      })
      .onConflictDoNothing()
  }
}

// ═══════════════════════════════════════════
// 3. 查询已持久化的仓位记录
// ═══════════════════════════════════════════

/** 查询已持久化的 OPEN 仓位 */
export async function getStoredOpenPositions(
  apiKeyId: number
): Promise<PositionRecord[]> {
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.apiKeyId, apiKeyId), eq(positions.status, 'OPEN')))
    .orderBy(desc(positions.openedAt))

  return rows.map(mapPositionRow)
}

/** 查询已持久化的 CLOSED 仓位（分页） */
export async function getClosedPositions(
  apiKeyId: number,
  params: {
    symbol?: string
    startDate?: string
    endDate?: string
    page?: number
    pageSize?: number
  }
): Promise<{records: PositionRecord[]; total: number}> {
  const {symbol, startDate, endDate, page = 1, pageSize = 50} = params
  const conditions: any[] = [
    and(eq(positions.apiKeyId, apiKeyId), eq(positions.status, 'CLOSED'))
  ]

  if (symbol) conditions.push(eq(positions.symbol, symbol))
  if (startDate)
    conditions.push(
      sql`${positions.closedAt} >= ${startDate + 'T00:00:00.000Z'}::timestamptz`
    )
  if (endDate)
    conditions.push(
      sql`${positions.closedAt} <= ${endDate + 'T23:59:59.999Z'}::timestamptz`
    )

  const where = and(...conditions)

  const [countResult] = await db
    .select({count: sql<number>`count(*)::int`})
    .from(positions)
    .where(where)
  const total = countResult?.count ?? 0

  const offset = (page - 1) * pageSize
  const rows = await db
    .select()
    .from(positions)
    .where(where)
    .orderBy(desc(positions.closedAt))
    .limit(pageSize)
    .offset(offset)

  return {records: rows.map(mapPositionRow), total}
}

/** 获取仓位详情（含关联订单和分析） */
export async function getPositionDetail(
  positionId: number,
  apiKeyId: number
): Promise<PositionDetail | null> {
  const [pos] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, positionId), eq(positions.apiKeyId, apiKeyId)))
    .limit(1)

  if (!pos) return null

  // 查询关联的成交记录
  const entryIds = (pos.entryTradeIds as number[]) ?? []
  const exitIds = (pos.exitTradeIds as number[]) ?? []
  const allTradeIds = [...entryIds, ...exitIds]

  let orders: PositionDetail['orders'] = []

  if (allTradeIds.length > 0) {
    const tradeRows = await db
      .select({
        tradeId: trades.tradeId,
        price: trades.price,
        amount: trades.amount,
        side: trades.side,
        realizedPnl: trades.realizedPnl,
        feeUsdt: trades.feeUsdt,
        isLiquidation: trades.isLiquidation,
        executedAt: trades.executedAt
      })
      .from(trades)
      .where(inArray(trades.id, allTradeIds))
      .orderBy(asc(trades.executedAt))

    orders = tradeRows.map(t => ({
      tradeId: t.tradeId,
      price: parseFloat(t.price),
      amount: parseFloat(t.amount),
      side: t.side,
      realizedPnl: parseFloat(t.realizedPnl ?? '0'),
      feeUsdt: parseFloat(t.feeUsdt ?? '0'),
      isLiquidation: t.isLiquidation ?? false,
      executedAt: t.executedAt.toISOString()
    }))
  }

  const record = mapPositionRow(pos)
  const netPnl = record.realizedPnl - record.totalFee
  const roiPct = record.roiPct ?? 0
  const ddPct = record.maxDrawdownPct ?? 0
  const holdingSecs = record.holdingSeconds ?? 0

  return {
    ...record,
    orders,
    analysis: {
      holdingTimeFormatted: formatHoldingTime(holdingSecs),
      netPnl,
      roiPct,
      maxDrawdownPct: ddPct,
      winLoss: netPnl > 0 ? 'win' : netPnl < 0 ? 'loss' : 'breakeven'
    }
  }
}

/** 获取仓位统计汇总 */
export async function getPositionSummary(
  apiKeyId: number,
  params?: {startDate?: string; endDate?: string}
): Promise<PositionSummary> {
  const conditions: any[] = [eq(positions.apiKeyId, apiKeyId)]
  if (params?.startDate)
    conditions.push(
      sql`${positions.closedAt} >= ${params.startDate + 'T00:00:00.000Z'}::timestamptz`
    )
  if (params?.endDate)
    conditions.push(
      sql`${positions.closedAt} <= ${params.endDate + 'T23:59:59.999Z'}::timestamptz`
    )

  const where = and(...conditions)

  const [stats] = await db
    .select({
      openCount: sql<number>`count(*) filter (where status = 'OPEN')::int`,
      closedCount: sql<number>`count(*) filter (where status = 'CLOSED')::int`,
      totalPnl: sql<string>`coalesce(sum(realized_pnl::numeric), 0)`,
      totalFee: sql<string>`coalesce(sum(total_fee::numeric), 0)`,
      winCount: sql<number>`count(*) filter (where status = 'CLOSED' and realized_pnl::numeric > 0)::int`,
      lossCount: sql<number>`count(*) filter (where status = 'CLOSED' and realized_pnl::numeric < 0)::int`,
      liqCount: sql<number>`count(*) filter (where is_liquidation = true)::int`,
      avgHolding: sql<string>`coalesce(avg(holding_seconds) filter (where status = 'CLOSED'), 0)`,
      avgRoi: sql<string>`coalesce(avg(roi_pct::numeric) filter (where status = 'CLOSED'), 0)`
    })
    .from(positions)
    .where(where)

  const closedCount = stats?.closedCount ?? 0
  const winCount = stats?.winCount ?? 0

  return {
    totalOpenPositions: stats?.openCount ?? 0,
    totalClosedPositions: closedCount,
    totalRealizedPnl: parseFloat(stats?.totalPnl ?? '0'),
    totalFee: parseFloat(stats?.totalFee ?? '0'),
    winCount,
    lossCount: stats?.lossCount ?? 0,
    winRate: closedCount > 0 ? (winCount / closedCount) * 100 : 0,
    totalLiquidationCount: stats?.liqCount ?? 0,
    avgHoldingSeconds: Math.round(parseFloat(stats?.avgHolding ?? '0')),
    avgRoiPct: parseFloat(stats?.avgRoi ?? '0')
  }
}

// ─── 行映射工具 ───

function mapPositionRow(row: any): PositionRecord {
  return {
    id: row.id,
    apiKeyId: row.apiKeyId,
    symbol: row.symbol,
    positionSide: row.positionSide as PositionSide,
    status: row.status as 'OPEN' | 'CLOSED',
    entryPrice: parseFloat(row.entryPrice),
    exitPrice: row.exitPrice ? parseFloat(row.exitPrice) : null,
    quantity: parseFloat(row.quantity),
    realizedPnl: parseFloat(row.realizedPnl ?? '0'),
    totalFee: parseFloat(row.totalFee ?? '0'),
    roiPct: row.roiPct ? parseFloat(row.roiPct) : null,
    maxDrawdownPct: row.maxDrawdownPct ? parseFloat(row.maxDrawdownPct) : null,
    holdingSeconds: row.holdingSeconds,
    isLiquidation: row.isLiquidation ?? false,
    openedAt:
      row.openedAt instanceof Date ? row.openedAt.toISOString() : row.openedAt,
    closedAt:
      row.closedAt instanceof Date
        ? row.closedAt.toISOString()
        : (row.closedAt ?? null)
  }
}
