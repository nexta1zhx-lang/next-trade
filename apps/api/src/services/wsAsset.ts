/**
 * 币安 WebSocket 资产变动监听 (ListenKey)
 *
 * 通过 User Data Stream 监听 ACCOUNT_UPDATE 事件，
 * 实时更新 Redis 中的最新资产缓存。
 *
 * 流程：
 *   1. POST /api/v3/userDataStream 创建 ListenKey
 *   2. 每 30 分钟 PUT 刷新 ListenKey
 *   3. 通过 WebSocket 连接 wss://stream.binance.com:9443/ws/<listenKey>
 *   4. 收到 ACCOUNT_UPDATE 事件，解析并更新 Redis
 */

import {createHmac} from 'node:crypto'
import {WebSocket as WsClient} from 'ws'
import {redis} from './redis.js'

const BASE_API = 'https://api.binance.com'
const WS_BASE = 'wss://stream.binance.com:9443/ws'

// 最大重连次数 & 指数退避基数
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_BASE_MS = 10_000
const MAX_RECONNECT_MS = 120_000

interface ListenKeyState {
  apiKeyId: number
  apiKey: string
  secret: string
  listenKey: string
  ws: WsClient | null
  refreshTimer: ReturnType<typeof setInterval> | null
  /** 重连 timeout handle，用于 stopAssetListener 时清除 */
  reconnectTimer: ReturnType<typeof setTimeout> | null
  /** 当前重连尝试次数 */
  reconnectAttempts: number
}

// 活跃的 ListenKey 映射
const activeListeners = new Map<number, ListenKeyState>()

/**
 * 为单个 API Key 创建并维护 ListenKey
 */
export async function startAssetListener(
  apiKeyId: number,
  apiKey: string,
  secret: string
): Promise<void> {
  // 如果已存在，先关闭（会清除所有定时器和 WS）
  stopAssetListener(apiKeyId)

  // 获取或创建 state，记录重连次数
  let state = activeListeners.get(apiKeyId)
  if (!state) {
    state = {
      apiKeyId,
      apiKey,
      secret,
      listenKey: '',
      ws: null,
      refreshTimer: null,
      reconnectTimer: null,
      reconnectAttempts: 0
    }
    activeListeners.set(apiKeyId, state)
  }

  // 检查重连次数上限
  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(
      `[wsAsset] key=${apiKeyId} 重连已达上限(${MAX_RECONNECT_ATTEMPTS}次)，停止重试`
    )
    activeListeners.delete(apiKeyId)
    return
  }

  try {
    // 1. 创建 ListenKey
    const listenKey = await createListenKey(apiKey, secret)
    console.log(`[wsAsset] key=${apiKeyId} 创建 ListenKey 成功`)

    // 重置重连计数
    state.reconnectAttempts = 0
    state.listenKey = listenKey

    // 2. 建立 WebSocket 连接
    const ws = new WsClient(`${WS_BASE}/${listenKey}`)

    ws.on('open', () => {
      console.log(`[wsAsset] key=${apiKeyId} WebSocket 已连接`)
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        handleAccountUpdate(apiKeyId, msg)
      } catch (err) {
        // 非 JSON 消息忽略
      }
    })

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(
        `[wsAsset] key=${apiKeyId} 断开(code=${code}): ${reason.toString()}`
      )
      // 指数退避重连，最大 2 分钟
      const currentState = activeListeners.get(apiKeyId)
      if (!currentState) return
      currentState.reconnectAttempts++
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, currentState.reconnectAttempts - 1),
        MAX_RECONNECT_MS
      )
      console.log(
        `[wsAsset] key=${apiKeyId} 第${currentState.reconnectAttempts}次重连(${delay}ms后)...`
      )
      currentState.reconnectTimer = setTimeout(() => {
        startAssetListener(apiKeyId, apiKey, secret)
      }, delay)
    })

    ws.on('error', err => {
      console.error(`[wsAsset] key=${apiKeyId} 错误:`, err.message)
    })

    state.ws = ws

    // 3. 每 30 分钟刷新 ListenKey
    state.refreshTimer = setInterval(
      async () => {
        try {
          await refreshListenKey(apiKey, secret, listenKey)
        } catch (err) {
          console.error(
            `[wsAsset] key=${apiKeyId} 刷新 ListenKey 失败:`,
            (err as Error).message
          )
          // 刷新失败 → 重新创建（不清除 state，复用重连计数）
          stopAssetListener(apiKeyId)
          startAssetListener(apiKeyId, apiKey, secret)
        }
      },
      30 * 60 * 1000
    )
  } catch (err) {
    console.error(
      `[wsAsset] key=${apiKeyId} 初始化失败:`,
      (err as Error).message
    )
    // 初始化失败也触发重连
    state.reconnectAttempts++
    const currentState = activeListeners.get(apiKeyId)
    if (
      currentState &&
      currentState.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    ) {
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, currentState.reconnectAttempts - 1),
        MAX_RECONNECT_MS
      )
      currentState.reconnectTimer = setTimeout(() => {
        startAssetListener(apiKeyId, apiKey, secret)
      }, delay)
    }
  }
}

/**
 * 停止某个 Key 的监听
 */
export function stopAssetListener(apiKeyId: number): void {
  const state = activeListeners.get(apiKeyId)
  if (!state) return

  if (state.refreshTimer) {
    clearInterval(state.refreshTimer)
    state.refreshTimer = null
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
  if (state.ws) {
    state.ws.removeAllListeners()
    state.ws.close()
    state.ws = null
  }

  activeListeners.delete(apiKeyId)
  console.log(`[wsAsset] key=${apiKeyId} 已停止监听`)
}

/**
 * 停止所有监听
 */
export function stopAllListeners(): void {
  for (const keyId of activeListeners.keys()) {
    stopAssetListener(keyId)
  }
}

// ─── ListenKey API ───

async function createListenKey(
  apiKey: string,
  secret: string
): Promise<string> {
  const timestamp = Date.now()
  const queryString = `timestamp=${timestamp}`
  const signature = createHmac('sha256', secret)
    .update(queryString)
    .digest('hex')

  const res = await fetch(
    `${BASE_API}/api/v3/userDataStream?${queryString}&signature=${signature}`,
    {
      method: 'POST',
      headers: {'X-MBX-APIKEY': apiKey}
    }
  )

  if (!res.ok) {
    throw new Error(
      `Create ListenKey failed: ${res.status} ${await res.text()}`
    )
  }

  const data = (await res.json()) as {listenKey: string}
  return data.listenKey
}

async function refreshListenKey(
  apiKey: string,
  secret: string,
  listenKey: string
): Promise<void> {
  const timestamp = Date.now()
  const queryString = `listenKey=${listenKey}&timestamp=${timestamp}`
  const signature = createHmac('sha256', secret)
    .update(queryString)
    .digest('hex')

  const res = await fetch(
    `${BASE_API}/api/v3/userDataStream?${queryString}&signature=${signature}`,
    {
      method: 'PUT',
      headers: {'X-MBX-APIKEY': apiKey}
    }
  )

  if (!res.ok) {
    throw new Error(
      `Refresh ListenKey failed: ${res.status} ${await res.text()}`
    )
  }
}

// ─── 事件处理 ───

interface AccountUpdateEvent {
  e: 'ACCOUNT_UPDATE'
  E: number
  a: {
    B: Array<{
      a: string // asset
      w: string // wallet balance
      m: string // margin balance (for isolated margin)
    }>
    P: Array<{
      s: string // symbol
      pa: string // position amount
      ep: string // entry price
      up: string // unrealized PnL
    }>
  }
}

function handleAccountUpdate(
  apiKeyId: number,
  msg: Record<string, unknown>
): void {
  if (msg.e !== 'ACCOUNT_UPDATE') return

  const event = msg as unknown as AccountUpdateEvent
  const balances = event.a.B || []
  const positions = event.a.P || []

  // 折算总 USDT 价值
  let totalNetVal = 0
  for (const b of balances) {
    if (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(b.a)) {
      totalNetVal += Number(b.w)
    }
  }
  // 加上合约未实现盈亏（USDT 本位）
  for (const p of positions) {
    totalNetVal += Number(p.up)
  }

  // 更新 Redis 缓存（只更新 totalNetVal，精确值等下次 REST 采集）
  updateWsCache(apiKeyId, totalNetVal, event.E)
}

// 已知 userId 缓存（避免每次事件都查 DB），只存入内存不保证实时性
const userIdCache = new Map<number, number>()

async function updateWsCache(
  apiKeyId: number,
  totalNetVal: number,
  eventTime: number
): Promise<void> {
  if (redis.status !== 'ready') return

  // 直接按 userId 读单个 key，取代全量 redis.keys() 扫描
  let userId = userIdCache.get(apiKeyId)
  if (!userId) {
    try {
      const {db} = await import('../db/index.js')
      const {apiKeys} = await import('../db/schema.js')
      const {eq} = await import('drizzle-orm')
      const [row] = await db
        .select({userId: apiKeys.userId})
        .from(apiKeys)
        .where(eq(apiKeys.id, apiKeyId))
        .limit(1)
      if (!row) return
      userId = row.userId
      userIdCache.set(apiKeyId, userId)
    } catch {
      return
    }
  }

  const key = `asset:current:${userId}`
  try {
    const raw = await redis.get(key)
    const map: Record<string, any> = raw ? JSON.parse(raw) : {}
    if (map[String(apiKeyId)]) {
      map[String(apiKeyId)].totalNetVal = totalNetVal
      map[String(apiKeyId)].wsUpdateAt = new Date(eventTime).toISOString()
      await redis.set(key, JSON.stringify(map), 'EX', 3600)
    }
  } catch (err) {
    console.error('[wsAsset] updateWsCache 失败:', (err as Error).message)
  }
}
