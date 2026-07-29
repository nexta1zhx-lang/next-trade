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
import {
  publishTrade,
  publishPositionUpdate,
  publishEquityUpdate
} from '../streams/eventStream.js'
import {redis} from '../services/redis.js'
import type {WebSocket as WsClient} from 'ws'

const INACTIVITY_TIMEOUT = 30_000
const EVENTS = 'ORDER_TRADE_UPDATE/ACCOUNT_UPDATE'

// 客户端心跳检测间隔（每 15s 检查一次僵尸连接）
const HEARTBEAT_INTERVAL = 15_000

// ─── 状态 ───

interface KeyState {
  apiKeyRaw: string
  listenKey: string
  keepAliveTimer: ReturnType<typeof setInterval> | null
  clients: Set<WsClient>
  cleanupTimer: ReturnType<typeof setTimeout> | null
  /** 心跳检测定时器，定期清理僵尸连接 */
  heartbeatTimer: ReturnType<typeof setInterval> | null
  /** 上一个已知权益值（用于计算 deltaEquity） */
  lastEquity: number | null
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
    }).catch(err => {
      console.error('[wsIngestor] publishTrade 失败:', (err as Error).message)
    })

    publishPositionUpdate(apiKeyId).catch(err => {
      console.error(
        '[wsIngestor] publishPositionUpdate 失败:',
        (err as Error).message
      )
    })
  } else if (msg.e === 'ACCOUNT_UPDATE') {
    const a = msg.a
    if (a?.P?.length) {
      publishPositionUpdate(apiKeyId).catch(err => {
        console.error(
          '[wsIngestor] ACCOUNT_UPDATE publishPositionUpdate 失败:',
          (err as Error).message
        )
      })
    }

    // ── 权益增量事件 ──
    const balances: Array<{a: string; wb: string}> = a?.B ?? []
    const usdtBalance = balances.find((b: any) => b.a === 'USDT')
    const futuresWallet = parseFloat(usdtBalance?.wb ?? '0')

    const posArr: Array<{up: string}> = a?.P ?? []
    let unrealizedPnl = 0
    for (const p of posArr) {
      unrealizedPnl += parseFloat(p.up ?? '0')
    }

    const currentEquity = futuresWallet + unrealizedPnl
    const lastEquity = ks.lastEquity
    ks.lastEquity = currentEquity

    // 只在有前值时才发布 deltaEquity
    const deltaEquity = lastEquity !== null ? currentEquity - lastEquity : 0

    // 检测强平：持仓归零 + 权益大幅下降
    const isLiquidation =
      lastEquity !== null &&
      currentEquity < lastEquity * 0.5 &&
      posArr.length === 0

    publishEquityUpdate({
      type: 'EQUITY_UPDATE',
      apiKeyId,
      eventTime: Number(msg.E || Date.now()),
      futuresWallet: String(futuresWallet),
      unrealizedPnl: String(unrealizedPnl),
      deltaEquity: String(deltaEquity),
      isLiquidation
    }).catch(err => {
      console.error(
        '[wsIngestor] publishEquityUpdate 失败:',
        (err as Error).message
      )
    })

    // ── 更新 Redis 实时持仓缓存 ──
    updateLivePositionsCache(apiKeyId, a?.P ?? []).catch(err => {
      console.error('[wsIngestor] 更新持仓缓存失败:', (err as Error).message)
    })
  } else if (msg.e === 'listenKeyExpired') {
    cleanup(apiKeyId)
    ensureConn(apiKeyId).catch(err => {
      console.error(
        '[wsIngestor] listenKeyExpired 重连失败:',
        (err as Error).message
      )
    })
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
        ).catch(err => {
          console.error(
            '[wsIngestor] keepAlive 刷新失败:',
            (err as Error).message
          )
        })
      },
      50 * 60 * 1000
    ),
    clients: new Set(),
    cleanupTimer: null,
    heartbeatTimer: null,
    lastEquity: null
  }
  // heartbeatTimer 在 ks 赋值后设置，回调内才能引用 ks
  ks.heartbeatTimer = setInterval(() => {
    for (const c of ks.clients) {
      if (
        c.readyState !== WebSocket.OPEN &&
        c.readyState !== WebSocket.CONNECTING
      ) {
        ks.clients.delete(c)
      }
    }
  }, HEARTBEAT_INTERVAL)
  keyMap.set(apiKeyId, ks)
  lkToId.set(listenKey, apiKeyId)
  reconnectSharedWs()
  return ks
}

function cleanup(apiKeyId: number): void {
  const ks = keyMap.get(apiKeyId)
  if (!ks || ks.clients.size > 0) return
  if (ks.keepAliveTimer) {
    clearInterval(ks.keepAliveTimer)
    ks.keepAliveTimer = null
  }
  if (ks.heartbeatTimer) {
    clearInterval(ks.heartbeatTimer)
    ks.heartbeatTimer = null
  }
  if (ks.cleanupTimer) {
    clearTimeout(ks.cleanupTimer)
    ks.cleanupTimer = null
  }
  lkToId.delete(ks.listenKey)
  apiCall(
    ks.apiKeyRaw,
    'DELETE',
    `/fapi/v1/listenKey?listenKey=${ks.listenKey}`
  ).catch(err => {
    console.error('[wsIngestor] 删除 listenKey 失败:', (err as Error).message)
  })
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
    // 客户端断连时自动清理
    ws.on('close', () => unsubscribeClient(apiKeyId, ws))
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

// ─── Redis 实时持仓缓存（Hash 结构，供 GET /api/v1/positions 直接读取） ───
// Key: positions:live:{apiKeyId}
// Field: {symbol} (如 "BTCUSDT")
// Value: JSON { symbol, entryPrice, quantity, unrealizedPnl, leverage, marginType, liquidationPrice, updatedAt }
// 无 TTL，靠 updatedAt 判断新鲜度（30s），
// WS 在线持续更新，不掉币安 API
//
// 坑点处理:
//   1. pa === "0" → HDEL 删除（完全平仓清理）
//   2. 静止期 markPrice 不更新 → 由前端用 ticker WS 自行计算
//   3. 无物理 TTL，靠 updatedAt 新鲜度判断

const LIVE_POSITIONS_HASH_PREFIX = 'positions:live:'

async function updateLivePositionsCache(
  apiKeyId: number,
  positionsData: Array<{
    s: string
    pa: string
    ep: string
    up: string
  }>
): Promise<void> {
  if (redis.status !== 'ready') {
    console.warn('[wsIngestor] Redis 不可用，跳过持仓缓存')
    return
  }
  if (positionsData.length === 0) return
  console.log(
    `[wsIngestor] 🔄 ACCOUNT_UPDATE key=${apiKeyId}, ${positionsData.length} 个持仓`
  )
  const hashKey = `${LIVE_POSITIONS_HASH_PREFIX}${apiKeyId}`
  const now = Date.now()
  const multi = redis.multi()

  // 先读所有旧缓存（一次 HGETALL 替代 N 次 HGET）
  let oldCache: Record<string, any> = {}
  try {
    const raw = await redis.hgetall(hashKey)
    if (raw) {
      for (const [k, v] of Object.entries(raw)) {
        try {
          if (v) oldCache[k] = JSON.parse(v)
        } catch {}
      }
    }
  } catch {}

  let hasChanges = false

  for (const p of positionsData) {
    const amt = parseFloat(p.pa)

    if (Math.abs(amt) < 1e-8) {
      // pa === "0" → 完全平仓，删除该持仓
      multi.hdel(hashKey, p.s)
      hasChanges = true
      // 同时从 oldCache 中删除，避免下面残留
      delete oldCache[p.s]
      continue
    }

    const oldVal = oldCache[p.s] ?? {}
    const newVal = {
      symbol: p.s,
      positionSide: amt > 0 ? 'LONG' : 'SHORT',
      quantity: Math.abs(amt),
      entryPrice: parseFloat(p.ep),
      markPrice: oldVal.markPrice ?? 0,
      liquidationPrice: oldVal.liquidationPrice ?? 0,
      leverage: oldVal.leverage ?? 0,
      marginType: oldVal.marginType ?? 'cross',
      notional: oldVal.notional ?? 0,
      unrealizedPnl: parseFloat(p.up),
      updatedAt: now
    }

    multi.hset(hashKey, p.s, JSON.stringify(newVal))
    hasChanges = true
  }

  if (hasChanges) {
    await multi.exec().catch((err: Error) => {
      console.error('[wsIngestor] 持仓缓存写入失败:', err.message)
    })

    // 如果所有持仓都被删除（清仓），写入空标记避免反复调币安
    const remainingKeys = Object.keys(oldCache).filter(
      k =>
        !positionsData.some(
          p => Math.abs(parseFloat(p.pa)) >= 1e-8 && p.s === k
        )
    )
    const allCleared = positionsData.every(
      p => Math.abs(parseFloat(p.pa)) < 1e-8
    )
    if (allCleared && remainingKeys.length === 0) {
      await redis
        .hset(hashKey, '_empty', JSON.stringify({updatedAt: Date.now()}))
        .catch(() => {})
    }

    console.log(
      `[wsIngestor] ✅ 持仓缓存已更新 key=${apiKeyId}, ${positionsData.length} 条`
    )
  }
}
