/**
 * WebSocket 行情推送服务
 *
 * 连接交易所公共 WebSocket，收到 ticker 后通过 Server-Sent Events (SSE)
 * 推送给前端。无需 API Key，完全免费。
 *
 * 支持的交易所:
 *   - Binance: wss://stream.binance.com:9443/ws/!miniTicker@arr
 */

import WebSocket from 'ws'

type TickerCallback = (
  tickers: Array<{
    symbol: string
    price: string
    change: string
    volume: string
    high: string
    low: string
  }>
) => void

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let subscribers = new Set<TickerCallback>()

/** 启动 Binance 迷你 ticker 流 */
export function startBinanceTicker() {
  if (ws) return // 已连接

  const connect = () => {
    ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr')

    ws.on('open', () => {
      console.log('[wsTicker] Binance WS connected')
    })

    ws.on('message', (data: Buffer) => {
      try {
        const raw: Array<{
          e: string
          E: number
          s: string
          c: string
          v: string
          h: string
          l: string
          p: string
          P: string
        }> = JSON.parse(data.toString())

        const tickers = raw.map(t => ({
          symbol: t.s,
          price: t.c,
          change: t.p,
          volume: t.v,
          high: t.h,
          low: t.l
        }))

        for (const cb of subscribers) {
          try {
            cb(tickers)
          } catch {}
        }
      } catch {}
    })

    ws.on('close', () => {
      console.log('[wsTicker] Binance WS disconnected, reconnecting in 5s...')
      ws = null
      reconnectTimer = setTimeout(connect, 5000)
    })

    ws.on('error', err => {
      console.error('[wsTicker] Binance WS error:', err.message)
      ws?.close()
    })
  }

  connect()
}

/** 停止连接 */
export function stopBinanceTicker() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  ws?.close()
  ws = null
}

/** 订阅 ticker 推送 */
export function subscribeTicker(cb: TickerCallback): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
    if (subscribers.size === 0) stopBinanceTicker()
  }
}
