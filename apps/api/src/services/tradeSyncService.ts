/**
 * 成交记录同步服务
 *
 * 职责:
 *   1. 首次绑 Key: 拉取最近 30 天历史成交（全量）
 *   2. 定时对账: 按 lastTradeId 增量拉取，补漏校验
 *   3. 标准化: Binance 原始成交 → trades 表格式
 *
 * 标准化映射:
 *   Binance side=SIDE positionSide=LONG/ SHORT → OPEN_LONG / CLOSE_LONG / OPEN_SHORT / CLOSE_SHORT
 *   强平单: 通过 realizedPnl 绝对值较大 + commissionAsset=USDT 近似判断
 */

/**
 * 成交记录同步服务 — 原生 fetch + HMAC 签名
 *
 * 使用原生 fetch 替代 Binance SDK 的 sendSignedRequest（后者 resp.data 是函数，非数据）。
 */

import crypto from 'crypto'
import {db} from '../db/index.js'
import {trades, apiKeys} from '../db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from './crypto.js'
import {syncPositionsFromTrades} from './positionService.js'

const BASE = 'https://fapi.binance.com'
const SYMBOLS_BATCH_SIZE = 50
const BATCH_DELAY_MS = 1000
const PAGE_LIMIT = 200

// ─── 工具函数 ───

function sign(secret: string, qs: string): string {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex')
}

async function signedGet(
  apiKey: string,
  secret: string,
  path: string,
  params: Record<string, unknown>
): Promise<any> {
  const ts = Date.now()
  const qsParts = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qsParts.set(k, String(v))
  qsParts.set('recvWindow', '60000')
  qsParts.set('timestamp', String(ts))
  const qs = qsParts.toString()
  const signature = sign(secret, qs)
  const res = await fetch(`${BASE}${path}?${qs}&signature=${signature}`, {
    headers: {'X-MBX-APIKEY': apiKey}
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

function normalizeSide(side: string, positionSide: string): string {
  const isBuy = side === 'BUY'
  const isLong = positionSide === 'LONG'
  if (isBuy && isLong) return 'OPEN_LONG'
  if (!isBuy && isLong) return 'CLOSE_LONG'
  if (!isBuy && !isLong) return 'OPEN_SHORT'
  return 'CLOSE_SHORT'
}

function isLikelyLiquidation(trade: any): boolean {
  return Math.abs(parseFloat(trade.realizedPnl ?? '0')) > 100
}

// ─── 获取 Key + 币种列表 ───

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

async function fetchSymbols(): Promise<string[]> {
  const res = await fetch(`${BASE}/fapi/v1/exchangeInfo`)
  const json = (await res.json()) as any
  const symbols: string[] = (json.symbols ?? [])
    .filter(
      (s: any) =>
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING'
    )
    .map((s: any) => s.symbol)
  console.log('[tradeSync] USDT perpetual symbols:', symbols.length)
  return symbols.sort()
}

// ─── 单币种同步 ───

interface SyncResult {
  symbol: string
  insertedCount: number
  lastTradeId: string | null
}

async function syncSymbol(
  apiKey: string,
  secret: string,
  apiKeyId: number,
  symbol: string,
  opts: {startTime?: number; fromId?: number}
): Promise<SyncResult> {
  let insertedCount = 0
  let lastTradeId: string | null = null
  let fromId = opts.fromId

  for (let page = 0; page < 50; page++) {
    const params: Record<string, unknown> = {symbol, limit: PAGE_LIMIT}
    if (fromId) params.fromId = fromId
    if (opts.startTime && !fromId) params.startTime = opts.startTime

    const rows: any[] = await signedGet(
      apiKey,
      secret,
      '/fapi/v1/userTrades',
      params
    )
    if (!Array.isArray(rows) || rows.length === 0) break

    for (const row of rows) {
      await db
        .insert(trades)
        .values({
          apiKeyId,
          tradeId: String(row.id),
          symbol: row.symbol,
          marketType: 'PERP',
          side: normalizeSide(row.side, row.positionSide ?? 'BOTH'),
          price: String(row.price),
          amount: String(row.qty),
          quoteQty: String(row.quoteQty),
          realizedPnl: String(row.realizedPnl ?? '0'),
          feeUsdt: String(row.commission ?? '0'),
          isLiquidation: isLikelyLiquidation(row),
          executedAt: new Date(Number(row.time))
        })
        .onConflictDoNothing()
      insertedCount++
      lastTradeId = String(row.id)
    }
    if (rows.length < PAGE_LIMIT) break
    fromId = rows[rows.length - 1].id
  }
  return {symbol, insertedCount, lastTradeId}
}

// ─── 公开 API ───

export async function syncAllSymbols(
  apiKeyId: number,
  startTime?: number
): Promise<{totalInserted: number; symbolCount: number}> {
  const {apiKey, secret} = await getKey(apiKeyId)
  const symbols = await fetchSymbols()
  if (!startTime) startTime = Date.now() - 30 * 24 * 60 * 60 * 1000

  let totalInserted = 0
  for (let i = 0; i < symbols.length; i += SYMBOLS_BATCH_SIZE) {
    const batch = symbols.slice(i, i + SYMBOLS_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(sym => syncSymbol(apiKey, secret, apiKeyId, sym, {startTime}))
    )
    for (const r of results) {
      totalInserted += r.insertedCount
      if (r.insertedCount > 0)
        console.log(`[tradeSync] ${r.symbol}: ${r.insertedCount} 条`)
    }
    if (i + SYMBOLS_BATCH_SIZE < symbols.length) await delay(BATCH_DELAY_MS)
  }

  await db
    .update(apiKeys)
    .set({lastSyncAt: new Date()})
    .where(eq(apiKeys.id, apiKeyId))
  console.log(
    `[tradeSync] Key ${apiKeyId}: ${totalInserted} 条, ${symbols.length} 币种`
  )

  if (totalInserted > 0) await syncPositionsFromTrades(apiKeyId)
  return {totalInserted, symbolCount: symbols.length}
}

export async function incrementalSync(
  apiKeyId: number
): Promise<{totalInserted: number}> {
  const {apiKey, secret} = await getKey(apiKeyId)
  const symbols = await fetchSymbols()

  const [key] = await db
    .select({lastSyncAt: apiKeys.lastSyncAt})
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  const startTime =
    key?.lastSyncAt?.getTime() ?? Date.now() - 24 * 60 * 60 * 1000

  let totalInserted = 0
  for (let i = 0; i < symbols.length; i += SYMBOLS_BATCH_SIZE) {
    const batch = symbols.slice(i, i + SYMBOLS_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(sym => syncSymbol(apiKey, secret, apiKeyId, sym, {startTime}))
    )
    for (const r of results) totalInserted += r.insertedCount
    if (i + SYMBOLS_BATCH_SIZE < symbols.length) await delay(500)
  }

  if (totalInserted > 0) {
    await db
      .update(apiKeys)
      .set({lastSyncAt: new Date()})
      .where(eq(apiKeys.id, apiKeyId))
    await syncPositionsFromTrades(apiKeyId)
  }
  return {totalInserted}
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
