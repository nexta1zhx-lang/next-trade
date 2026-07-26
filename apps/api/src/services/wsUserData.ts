/**
 * WebSocket 用户数据流服务 — /private/stream 单连接多 Key
 *
 * 架构:
 *   一条共享 WS 连接 wss://fstream.binance.com/private/stream
 *   通过 query param listenKeys=k1,k2 订阅多个用户数据流
 *   前端连接/断开来控制 listenKey 生命周期
 *
 * 参考 Binance.md 规范:
 *   Private: wss://fstream.binance.com/private
 *   格式:    listenKey=<key>&events=ORDER_TRADE_UPDATE/ACCOUNT_UPDATE
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
const WS_PRIVATE = 'wss://fstream.binance.com/private'
const INACTIVITY_TIMEOUT = 30_000
const EVENTS = 'ORDER_TRADE_UPDATE/ACCOUNT_UPDATE'

// ─── 共享 WS 连接 ───

let sharedWs: WsClient | null = null
let sharedWsReconnectTimer: ReturnType<typeof setTimeout> | null = null

// ─── 每个 Key 的状态 ───

interface KeyState {
  apiKeyRaw: string
  listenKey: string
  keepAliveTimer: ReturnType<typeof setInterval> | null
  clients: Set<WsClient>
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const keyMap = new Map<number, KeyState>() // apiKeyId → state
const lkToId = new Map<string, number>() // listenKey → apiKeyId

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

// ─── 共享 WS 管理（query params 多 Key） ───

/** 构建 listenKeys 列表，重新连接共享 WS */
function reconnectSharedWs(): void {
  if (sharedWs) {
    sharedWs.removeAllListeners()
    sharedWs.close()
    sharedWs = null
  }
  if (sharedWsReconnectTimer) {
    clearTimeout(sharedWsReconnectTimer)
    sharedWsReconnectTimer = null
  }

  const lks = Array.from(keyMap.values())
    .map(ks => ks.listenKey)
    .filter(Boolean)
  if (lks.length === 0) return

  const url = `${WS_PRIVATE}/stream?listenKeys=${lks.join(',')}&events=${EVENTS}`
  try {
    sharedWs = new WebSocket(url)
    sharedWs.on('message', (data: Buffer) => {
      const raw = data.toString()
      // 过滤订阅回执 {"stream":"...","result":null}
      if (raw.includes('"result"')) return
      try {
        const msg = JSON.parse(raw)
        // /private/stream 返回的事件中 data.listenKey 标识所属 Key
        const lk = msg?.data?.listenKey ?? msg?.listenKey
        if (!lk) return
        const apiKeyId = lkToId.get(lk)
        if (!apiKeyId) return
        const ks = keyMap.get(apiKeyId)
        if (!ks) return
        onBinanceMessage(apiKeyId, ks, msg, raw)
      } catch {}
    })
    sharedWs.on('close', () => {
      sharedWs = null
      sharedWsReconnectTimer = setTimeout(reconnectSharedWs, 3000)
    })
    sharedWs.on('error', () => {})
  } catch {}
}

// ─── ListenKey 管理 ───

async function ensureConn(apiKeyId: number): Promise<KeyState> {
  const existing = keyMap.get(apiKeyId)
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

  const ks: KeyState = {
    apiKeyRaw,
    listenKey,
    keepAliveTimer: null,
    clients: new Set(),
    cleanupTimer: null
  }
  keyMap.set(apiKeyId, ks)
  lkToId.set(listenKey, apiKeyId)

  // 启动 keep-alive
  ks.keepAliveTimer = setInterval(
    () => {
      apiCall(
        apiKeyRaw,
        'PUT',
        `/fapi/v1/listenKey?listenKey=${listenKey}`
      ).catch(() => {})
    },
    50 * 60 * 1000
  )

  // 重建共享连接（含新的 listenKey）
  reconnectSharedWs()
  return ks
}

function cleanup(apiKeyId: number): void {
  const ks = keyMap.get(apiKeyId)
  if (!ks || ks.clients.size > 0) return
  if (ks.keepAliveTimer) clearInterval(ks.keepAliveTimer)
  lkToId.delete(ks.listenKey)
  // 删除 listenKey
  apiCall(
    ks.apiKeyRaw,
    'DELETE',
    `/fapi/v1/listenKey?listenKey=${ks.listenKey}`
  ).catch(() => {})
  keyMap.delete(apiKeyId)

  // 重建共享连接（不含已删除的 listenKey）
  reconnectSharedWs()
}

// ─── 事件处理 ───

function onBinanceMessage(
  apiKeyId: number,
  ks: KeyState,
  msg: any,
  raw: string
): void {
  // 转发给前端
  for (const c of ks.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(raw)
  }

  if (msg.e === 'ORDER_TRADE_UPDATE') handleTrade(apiKeyId, msg)
  else if (msg.e === 'ACCOUNT_UPDATE') handleAccountUpdate(apiKeyId, msg)
  else if (msg.e === 'listenKeyExpired') {
    cleanup(apiKeyId)
    // 自动重建
    ensureConn(apiKeyId).catch(() => {})
  }
}

function handleAccountUpdate(apiKeyId: number, data: any): void {
  const a = data.a
  if (!a?.P?.length) return
  const hasPositionChange = a.P.some(
    (p: any) => parseFloat(p.pa ?? '0') !== 0 || parseFloat(p.cr ?? '0') !== 0
  )
  if (hasPositionChange) {
    syncPositionsFromTrades(apiKeyId).catch(() => {})
  }
}

function handleTrade(apiKeyId: number, data: any): void {
  const o = data.o
  if (!o) return
  if (o.X !== 'FILLED' && o.x !== 'TRADE') return
  const price = parseFloat(o.ap || o.L || o.p || '0')
  const qty = parseFloat(o.l || o.z || o.q || '0')
  if (price <= 0 || qty <= 0) return

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

export async function subscribeClient(
  apiKeyId: number,
  ws: WsClient
): Promise<boolean> {
  try {
    const ks = await ensureConn(apiKeyId)
    ks.clients.add(ws)
    if (ks.cleanupTimer) {
      clearTimeout(ks.cleanupTimer)
      ks.cleanupTimer = null
    }
    return true
  } catch {
    return false
  }
}

export function unsubscribeClient(apiKeyId: number, ws: WsClient): void {
  const ks = keyMap.get(apiKeyId)
  if (!ks) return
  ks.clients.delete(ws)
  if (ks.clients.size === 0)
    ks.cleanupTimer = setTimeout(() => cleanup(apiKeyId), INACTIVITY_TIMEOUT)
}
