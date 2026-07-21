/**
 * 多交易所仓位聚合服务
 *
 * - 内部维护适配器注册表
 * - 支持单个/批量拉取，错误隔离
 * - 供 Hono 路由层调用
 */

import {createHash} from 'node:crypto'
import {redis} from './redis.js'
import type {
  IExchangeAdapter,
  CredentialValidation,
  TradeHistoryQuery,
  TradeHistoryResult
} from '../adapters/base.adapter.js'
import type {TradeCandle, TradeMarker} from '@nexttrade/shared'
import {BinanceAdapter} from '../adapters/binance.adapter.js'
import {OkxAdapter} from '../adapters/okx.adapter.js'
import {db} from '../db/index.js'
import {tradeHistory as thTable} from '../db/schema/trade_history.js'
import {eq, and, desc, sql} from 'drizzle-orm'
import type {
  ExchangeId,
  ApiCredentials,
  UnifiedPosition,
  PositionQueryResult
} from '../types/position.js'

const adapters = new Map<ExchangeId, IExchangeAdapter>()

function getAdapter(ex: ExchangeId): IExchangeAdapter {
  let a = adapters.get(ex)
  if (!a) {
    a =
      ex === 'okx'
        ? (new OkxAdapter() as IExchangeAdapter)
        : new BinanceAdapter()
    adapters.set(ex, a)
  }
  return a
}

function cacheKey(ex: ExchangeId, c: ApiCredentials): string {
  return `pos:${createHash('sha256').update(`${ex}:${c.apiKey}:${c.apiSecret}`).digest('hex')}`
}

// ─── 通用凭据校验 ───
export async function validateCredentials(
  ex: ExchangeId,
  c: ApiCredentials
): Promise<CredentialValidation> {
  return getAdapter(ex).validateCredentials(c)
}

// ─── 当前持仓（带 5s 缓存） ───
export async function getPositions(
  ex: ExchangeId,
  c: ApiCredentials
): Promise<PositionQueryResult> {
  const k = cacheKey(ex, c)
  if (redis.status === 'ready') {
    try {
      const cached = await redis.get(k)
      if (cached)
        return {
          exchange: ex,
          success: true,
          positions: JSON.parse(cached) as UnifiedPosition[]
        }
    } catch {}
  }
  try {
    const positions = await getAdapter(ex).fetchPositions(c)
    if (redis.status === 'ready')
      redis.setex(k, 5, JSON.stringify(positions)).catch(() => {})
    return {exchange: ex, success: true, positions}
  } catch (err) {
    return {
      exchange: ex,
      success: false,
      positions: [],
      error: (err as Error).message
    }
  }
}

// ─── 历史成交分析（走适配器，无缓存） ───
export async function getTradeHistory(
  ex: ExchangeId,
  c: ApiCredentials,
  q: TradeHistoryQuery
): Promise<TradeHistoryResult> {
  return getAdapter(ex).fetchTradeHistory(c, q)
}

// ─── 按需计算单笔交易的 K 线 + MAE/MFE ───
export async function getTradeCandles(
  ex: ExchangeId,
  c: ApiCredentials,
  symbol: string,
  entryPrice: number,
  side: 'buy' | 'sell',
  openedAt: number,
  closedAt: number
): Promise<{
  candles: TradeCandle[]
  markers: TradeMarker[]
  mae: number
  mfe: number
}> {
  return getAdapter(ex).getTradeCandles(
    c,
    symbol,
    entryPrice,
    side,
    openedAt,
    closedAt
  )
}

// ─── 带增量同步的历史成交 ───
export async function syncAndGetTradeHistory(
  userId: number,
  ex: ExchangeId,
  c: ApiCredentials,
  q: TradeHistoryQuery
): Promise<TradeHistoryResult> {
  const {symbol, startDate, endDate} = q
  const startTime = new Date(`${startDate}T00:00:00.000Z`).getTime()

  // 查 DB 中该用户+交易所+交易对的最新成交时间
  const [latest] = symbol
    ? await db
        .select({latestTime: thTable.tradedAt})
        .from(thTable)
        .where(
          and(
            eq(thTable.userId, userId),
            eq(thTable.exchange, ex),
            eq(thTable.symbol, symbol)
          )
        )
        .orderBy(desc(thTable.tradedAt))
        .limit(1)
    : []

  // 如果 DB 已有数据且覆盖了请求起始时间，只拉增量
  if (latest && latest.latestTime) {
    const dbLatestMs = new Date(latest.latestTime).getTime()
    if (dbLatestMs >= startTime) {
      // DB 已有部分数据，只拉增量
      const deltaStart = new Date(dbLatestMs - 86400000)
        .toISOString()
        .slice(0, 10) // 往前多 1 天防漏
      const deltaQuery = {...q, startDate: deltaStart}
      const delta = await getAdapter(ex).fetchTradeHistory(c, deltaQuery)
      // 入库
      if (delta.records.length > 0) {
        await storeTradeRecords(userId, ex, delta)
      }
    }
  } else {
    // DB 无数据，全量拉取
    const full = await getAdapter(ex).fetchTradeHistory(c, q)
    if (full.records.length > 0) {
      await storeTradeRecords(userId, ex, full)
    }
    return full
  }

  // 从 DB 读取完整结果
  return readTradeHistoryFromDB(userId, ex, q)
}

/** 将成交记录写入 trade_history 表 */
async function storeTradeRecords(
  userId: number,
  ex: ExchangeId,
  result: TradeHistoryResult
) {
  for (const r of result.records) {
    try {
      await db
        .insert(thTable)
        .values({
          userId,
          exchange: ex,
          symbol: r.symbol,
          orderId: r.orderId,
          tradeId: r.id,
          side: r.side,
          price: String(r.entryPrice),
          qty: String(r.volume),
          realizedPnl: String(r.realizedPnl),
          commission: String(r.fee),
          mae: String(r.mae),
          mfe: String(r.mfe),
          tradedAt: new Date(r.closedAt)
        })
        .onConflictDoNothing()
    } catch {}
  }
}

/** 从 DB 读取历史成交记录 */
async function readTradeHistoryFromDB(
  userId: number,
  ex: ExchangeId,
  q: TradeHistoryQuery
): Promise<TradeHistoryResult> {
  const conditions = [eq(thTable.userId, userId), eq(thTable.exchange, ex)]
  if (q.symbol) conditions.push(eq(thTable.symbol, q.symbol))
  if (q.startDate)
    conditions.push(
      sql`${thTable.tradedAt} >= ${new Date(`${q.startDate}T00:00:00.000Z`)}`
    )
  if (q.endDate)
    conditions.push(
      sql`${thTable.tradedAt} <= ${new Date(`${q.endDate}T23:59:59.999Z`)}`
    )

  const rows = await db
    .select()
    .from(thTable)
    .where(and(...conditions))
    .orderBy(desc(thTable.tradedAt))
    .limit(500)

  const records = rows.map(r => ({
    id: r.tradeId,
    symbol: r.symbol,
    side: r.side as 'buy' | 'sell',
    entryPrice: Number(r.price),
    exitPrice: Number(r.price),
    realizedPnl: Number(r.realizedPnl),
    fee: Number(r.commission),
    mae: Number(r.mae),
    mfe: Number(r.mfe),
    openedAt: new Date(Number(r.tradedAt) - 60000).toISOString(),
    closedAt: new Date(r.tradedAt).toISOString(),
    orderId: r.orderId,
    volume: Number(r.qty)
  }))

  const wins = records.filter(r => r.realizedPnl > 0).length
  const totalPnl = records.reduce((s, r) => s + r.realizedPnl, 0)
  const totalFee = records.reduce((s, r) => s + r.fee, 0)
  const totalVol = records.reduce((s, r) => s + r.volume, 0)

  return {
    records,
    totalPnl,
    totalFee,
    winRate: records.length ? (wins / records.length) * 100 : 0,
    tradeCount: records.length,
    totalVolume: totalVol,
    candles: [],
    markers: []
  }
}

// ─── 批量拉取 ───
export async function getAllAccountPositions(
  accounts: Array<{exchange: ExchangeId; credentials: ApiCredentials}>
): Promise<PositionQueryResult[]> {
  const results = await Promise.allSettled(
    accounts.map(a => getPositions(a.exchange, a.credentials))
  )
  return results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : {
          exchange: 'binance' as ExchangeId,
          success: false,
          positions: [],
          error: r.reason?.message
        }
  )
}
