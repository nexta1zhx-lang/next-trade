/**
 * WS 采集器 — 接收 Binance 用户数据流，标准化后写入 Redis Streams
 *
 * 职责:
 *   1. 监听 Binance /private/stream WS 事件
 *   2. 标准化为 TradeEvent / PositionUpdateEvent
 *   3. XADD 写入事件流（不直接写 DB）
 *
 * 严禁:
 *   - 直接写 trades / positions 表
 *   - 调用 syncPositionsFromTrades
 */

import WebSocket from 'ws'
import {db} from '../db/index.js'
import {apiKeys} from '../db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../services/crypto.js'
import {publishTrade, publishPositionUpdate} from '../streams/eventStream.js'
import type {WebSocket as WsClient} from 'ws'

const INACTIVITY_TIMEOUT = 30_000
const EVENTS = 'ORDER_TRADE_UPDATE/ACCOUNT_UPDATE'

// ─── 状态 ───

interface KeyState {
  apiKeyRaw: string
  listenKey: string
  keepAliveTimer: ReturnType<typeof setInterval> | null
  clients: Set<WsClient>
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const keyMap = new Map<number, KeyState>()
const lkToId = new Map<string, number>()

let sharedWs: WsClient | null = null
let sharedWsReconnectTimer: ReturnType<typeof setTimeout> | null = null

// ─── HTTP ───

async function apiCall(apiKey: string, method: string, endpoint: string) {
  const res = await fetch(`https://fapi.binance.com${endpoint}`, {
    method,
    headers: {'X-MBX-APIKEY': apiKey}
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`)
  return JSON.parse(body)
}

// ─── 共享 WS ───

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

  const wsBase = 'wss://fstream.binance.com/private'
  const url = `${wsBase}/stream?listenKeys=${lks.join(',')}&events=${EVENTS}`
  try {
    sharedWs = new WebSocket(url)
    sharedWs.on('message', (data: Buffer) => {
      const raw = data.toString()
      if (raw.includes('"result"')) return
      try {
        const msg = JSON.parse(raw)
        const lk = msg?.data?.listenKey ?? msg?.listenKey
        if (!lk) return
        const apiKeyId = lkToId.get(lk)
        if (!apiKeyId) return
        const ks = keyMap.get(apiKeyId)
        if (!ks) return
        handleEvent(apiKeyId, ks, msg, raw)
      } catch {}
    })
    sharedWs.on('close', () => {
      sharedWs = null
      sharedWsReconnectTimer = setTimeout(reconnectSharedWs, 3000)
    })
    sharedWs.on('error', () => {})
  } catch {}
}

// ─── 事件处理: WS → Redis Stream ───

function handleEvent(
  apiKeyId: number,
  ks: KeyState,
  msg: any,
  raw: string
): void {
  // 转发给前端
  for (const c of ks.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(raw)
  }

  if (msg.e === 'ORDER_TRADE_UPDATE') {
    const o = msg.o
    if (!o || (o.X !== 'FILLED' && o.x !== 'TRADE')) return
    const price = parseFloat(o.ap || o.L || o.p || '0')
    const qty = parseFloat(o.l || o.z || o.q || '0')
    if (price <= 0 || qty <= 0) return

    publishTrade({
      type: 'TRADE_FILLED',
      apiKeyId,
      tradeId: String(o.t ?? o.i),
      symbol: o.s,
      marketType: 'PERP',
      side: normalizeSide(o.S, o.ps ?? 'BOTH'),
      price: String(price),
      amount: String(qty),
      quoteQty: String(price * qty),
      realizedPnl: String(o.rp ?? '0'),
      feeUsdt: String(o.n ?? '0'),
      isLiquidation: o.R === true && Math.abs(parseFloat(o.rp ?? '0')) > 50,
      executedAt: Number(o.T || msg.E)
    }).catch(() => {})

    publishPositionUpdate(apiKeyId).catch(() => {})
  } else if (msg.e === 'ACCOUNT_UPDATE') {
    const a = msg.a
    if (a?.P?.length) {
      publishPositionUpdate(apiKeyId).catch(() => {})
    }
  } else if (msg.e === 'listenKeyExpired') {
    cleanup(apiKeyId)
    ensureConn(apiKeyId).catch(() => {})
  }
}

function normalizeSide(
  side: string,
  positionSide: string
): 'OPEN_LONG' | 'CLOSE_LONG' | 'OPEN_SHORT' | 'CLOSE_SHORT' {
  const isBuy = side === 'BUY'
  if (positionSide === 'BOTH') return isBuy ? 'OPEN_LONG' : 'CLOSE_LONG'
  if (positionSide === 'LONG') return isBuy ? 'OPEN_LONG' : 'CLOSE_LONG'
  return isBuy ? 'CLOSE_SHORT' : 'OPEN_SHORT'
}

// ─── ListenKey 管理 ───

async function ensureConn(apiKeyId: number): Promise<KeyState> {
  const existing = keyMap.get(apiKeyId)
  if (existing?.listenKey) return existing

  const [key] = await db
    .select({
      apiKey: apiKeys.apiKey,
      secretEnc: apiKeys.secretEnc
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error(`Key not found: ${apiKeyId}`)

  const data = await apiCall(key.apiKey, 'POST', '/fapi/v1/listenKey')
  const listenKey = typeof data === 'string' ? data : (data?.listenKey ?? '')
  if (!listenKey) throw new Error('Failed to create listenKey')

  const ks: KeyState = {
    apiKeyRaw: key.apiKey,
    listenKey,
    keepAliveTimer: setInterval(
      () => {
        apiCall(
          key.apiKey,
          'PUT',
          `/fapi/v1/listenKey?listenKey=${listenKey}`
        ).catch(() => {})
      },
      50 * 60 * 1000
    ),
    clients: new Set(),
    cleanupTimer: null
  }
  keyMap.set(apiKeyId, ks)
  lkToId.set(listenKey, apiKeyId)
  reconnectSharedWs()
  return ks
}

function cleanup(apiKeyId: number): void {
  const ks = keyMap.get(apiKeyId)
  if (!ks || ks.clients.size > 0) return
  if (ks.keepAliveTimer) clearInterval(ks.keepAliveTimer)
  lkToId.delete(ks.listenKey)
  apiCall(
    ks.apiKeyRaw,
    'DELETE',
    `/fapi/v1/listenKey?listenKey=${ks.listenKey}`
  ).catch(() => {})
  keyMap.delete(apiKeyId)
  reconnectSharedWs()
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
