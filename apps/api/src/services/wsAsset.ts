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
import {config} from '../config.js'
import {redis} from './redis.js'

const BASE_API = 'https://api.binance.com'
const WS_BASE = 'wss://stream.binance.com:9443/ws'

interface ListenKeyState {
  apiKeyId: number
  apiKey: string
  secret: string
  listenKey: string
  ws: WsClient | null
  refreshTimer: ReturnType<typeof setInterval> | null
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
  // 如果已存在，先关闭
  stopAssetListener(apiKeyId)

  try {
    // 1. 创建 ListenKey
    const listenKey = await createListenKey(apiKey, secret)
    console.log(`[wsAsset] key=${apiKeyId} 创建 ListenKey 成功`)

    // 2. 建立 WebSocket 连接
    const ws = new WsClient(`${WS_BASE}/${listenKey}`)

    const state: ListenKeyState = {
      apiKeyId,
      apiKey,
      secret,
      listenKey,
      ws,
      refreshTimer: null
    }

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
      // 10 秒后自动重连
      setTimeout(() => {
        startAssetListener(apiKeyId, apiKey, secret)
      }, 10000)
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
          // 刷新失败 → 重新创建
          stopAssetListener(apiKeyId)
          startAssetListener(apiKeyId, apiKey, secret)
        }
      },
      30 * 60 * 1000
    )

    activeListeners.set(apiKeyId, state)
  } catch (err) {
    console.error(
      `[wsAsset] key=${apiKeyId} 初始化失败:`,
      (err as Error).message
    )
  }
}

/**
 * 停止某个 Key 的监听
 */
export function stopAssetListener(apiKeyId: number): void {
  const state = activeListeners.get(apiKeyId)
  if (!state) return

  if (state.refreshTimer) clearInterval(state.refreshTimer)
  if (state.ws) {
    state.ws.removeAllListeners()
    state.ws.close()
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

async function updateWsCache(
  apiKeyId: number,
  totalNetVal: number,
  eventTime: number
): Promise<void> {
  if (redis.status !== 'ready') return

  // 为用户所有 Key 更新 latestWs 字段
  const keys = await redis.keys(`asset:current:*`)
  for (const key of keys) {
    const raw = await redis.get(key)
    if (!raw) continue
    const map = JSON.parse(raw)
    if (map[String(apiKeyId)]) {
      map[String(apiKeyId)].totalNetVal = totalNetVal
      map[String(apiKeyId)].wsUpdateAt = new Date(eventTime).toISOString()
      await redis.set(key, JSON.stringify(map), 'EX', 3600)
    }
  }
}
