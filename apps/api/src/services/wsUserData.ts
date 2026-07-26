/**
 * WebSocket 用户数据流服务 — 按需连接
 *
 * 不再启动时连接所有 Key，改为前端请求时才建立连接:
 *   1. 前端 WS → /ws/user → 后端鉴权 → 创建 listenKey → 连币安 WS
 *   2. 币安推送的事件 → 写入 DB + 转发给前端
 *   3. 前端断开 → 30 秒无重连 → 清理 listenKey
 */

import WebSocket from 'ws'
import {db} from '../db/index.js'
import {trades} from '../db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from './crypto.js'
import {apiKeys} from '../db/schema.js'
import {syncPositionsFromTrades} from './positionService.js'
import type {WebSocket as WsClient} from 'ws'

const REST_BASE = 'https://fapi.binance.com'
const WS_BASE = 'wss://fstream.binance.com/private'
const INACTIVITY_TIMEOUT = 30_000

// ─── 状态 ───

interface BinanceConn {
  apiKeyRaw: string
  listenKey: string
  binanceWs: WsClient | null
  keepAliveTimer: ReturnType<typeof setInterval> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  clients: Set<WsClient>
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const connMap = new Map<number, BinanceConn>()

// ─── HTTP 工具 ───

async function apiCall(
  apiKey: string,
  method: string,
  endpoint: string
): Promise<any> {
  const res = await fetch(`${REST_BASE}${endpoint}`, {
    method,
    headers: {'X-MBX-APIKEY': apiKey}
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`)
  return JSON.parse(body)
}

// ─── ListenKey 管理 ───

async function ensureConn(apiKeyId: number): Promise<BinanceConn> {
  const existing = connMap.get(apiKeyId)
  if (existing?.listenKey) return existing

  const [key] = await db
    .select({apiKey: apiKeys.apiKey, secretEnc: apiKeys.secretEnc})
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error(`API Key not found: ${apiKeyId}`)

  const apiKeyRaw = key.apiKey
  const data = await apiCall(apiKeyRaw, 'POST', '/fapi/v1/listenKey')
  const listenKey = typeof data === 'string' ? data : (data?.listenKey ?? '')
  if (!listenKey) throw new Error(`Failed to create listenKey`)

  const conn: BinanceConn = {
    apiKeyRaw,
    listenKey,
    binanceWs: null,
    keepAliveTimer: null,
    reconnectTimer: null,
    clients: new Set(),
    cleanupTimer: null
  }
  connMap.set(apiKeyId, conn)
  connectBinance(conn)
  return conn
}

function connectBinance(conn: BinanceConn): void {
  const url = `${WS_BASE}/ws?listenKey=${conn.listenKey}&events=ORDER_TRADE_UPDATE/ACCOUNT_UPDATE`
  try {
    conn.binanceWs = new WebSocket(url)
    conn.binanceWs.on('open', () => {
      if (conn.keepAliveTimer) clearInterval(conn.keepAliveTimer)
      conn.keepAliveTimer = setInterval(
        () => {
          apiCall(
            conn.apiKeyRaw,
            'PUT',
            `/fapi/v1/listenKey?listenKey=${conn.listenKey}`
          ).catch(() => {})
        },
        50 * 60 * 1000
      )
    })
    conn.binanceWs.on('message', (data: Buffer) => {
      const raw = data.toString()
      onBinanceMessage(conn, raw)
      for (const c of conn.clients) {
        if (c.readyState === WebSocket.OPEN) c.send(raw)
      }
    })
    conn.binanceWs.on('close', () => {
      conn.binanceWs = null
      if (conn.keepAliveTimer) {
        clearInterval(conn.keepAliveTimer)
        conn.keepAliveTimer = null
      }
      if (conn.clients.size > 0)
        conn.reconnectTimer = setTimeout(() => connectBinance(conn), 3000)
    })
    conn.binanceWs.on('error', () => {})
  } catch {}
}

function findApiKeyId(listenKey: string): number {
  for (const [id, c] of connMap) if (c.listenKey === listenKey) return id
  return 0
}

function cleanup(apiKeyId: number): void {
  const conn = connMap.get(apiKeyId)
  if (!conn || conn.clients.size > 0) return
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
  if (conn.keepAliveTimer) clearInterval(conn.keepAliveTimer)
  if (conn.binanceWs) {
    conn.binanceWs.removeAllListeners()
    conn.binanceWs.close()
  }
  apiCall(
    conn.apiKeyRaw,
    'DELETE',
    `/fapi/v1/listenKey?listenKey=${conn.listenKey}`
  ).catch(() => {})
  connMap.delete(apiKeyId)
}

// ─── 事件处理 ───

function onBinanceMessage(conn: BinanceConn, raw: string): void {
  try {
    const msg = JSON.parse(raw)
    if (msg.e === 'ORDER_TRADE_UPDATE') handleTrade(conn, msg)
    else if (msg.e === 'listenKeyExpired') {
      const id = findApiKeyId(conn.listenKey)
      if (id) cleanup(id)
    }
  } catch {}
}

function handleTrade(conn: BinanceConn, data: any): void {
  const o = data.o
  if (!o) return
  if (o.X !== 'FILLED' && o.x !== 'TRADE') return
  const price = parseFloat(o.ap || o.L || o.p || '0')
  const qty = parseFloat(o.l || o.z || o.q || '0')
  if (price <= 0 || qty <= 0) return

  const apiKeyId = findApiKeyId(conn.listenKey)
  if (!apiKeyId) return
  const side =
    o.ps === 'BOTH'
      ? o.S === 'BUY'
        ? 'OPEN_LONG'
        : 'CLOSE_LONG'
      : o.S === 'BUY'
        ? o.ps === 'LONG'
          ? 'OPEN_LONG'
          : 'CLOSE_SHORT'
        : o.ps === 'LONG'
          ? 'CLOSE_LONG'
          : 'OPEN_SHORT'

  db.insert(trades)
    .values({
      apiKeyId,
      tradeId: String(o.t ?? o.i),
      symbol: o.s,
      marketType: 'PERP',
      side,
      price: String(price),
      amount: String(qty),
      quoteQty: String(price * qty),
      realizedPnl: String(o.rp ?? '0'),
      feeUsdt: String(o.n ?? '0'),
      isLiquidation: o.R === true && Math.abs(parseFloat(o.rp ?? '0')) > 50,
      executedAt: new Date(Number(o.T || data.E))
    })
    .onConflictDoNothing()
    .then(r => {
      if ((r as any).rowCount > 0) syncPositionsFromTrades(apiKeyId)
    })
    .catch(() => {})
}

// ─── 公开 API ───

/** 前端连接时调用：建立/复用币安 WS，将前端 WS 加入转发列表 */
export async function subscribeClient(
  apiKeyId: number,
  ws: WsClient
): Promise<boolean> {
  try {
    const conn = await ensureConn(apiKeyId)
    conn.clients.add(ws)
    if (conn.cleanupTimer) {
      clearTimeout(conn.cleanupTimer)
      conn.cleanupTimer = null
    }
    if (!conn.binanceWs && conn.clients.size > 0) connectBinance(conn)
    return true
  } catch {
    return false
  }
}

/** 前端断开时调用：移除客户端，30 秒无客户端则清理 */
export function unsubscribeClient(apiKeyId: number, ws: WsClient): void {
  const conn = connMap.get(apiKeyId)
  if (!conn) return
  conn.clients.delete(ws)
  if (conn.clients.size === 0)
    conn.cleanupTimer = setTimeout(() => cleanup(apiKeyId), INACTIVITY_TIMEOUT)
}
