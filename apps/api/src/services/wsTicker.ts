/**
 * WebSocket 行情推送服务
 *
 * 连接交易所公共 WebSocket，收到 ticker 后通过 Server-Sent Events (SSE)
 * 推送给前端。无需 API Key，完全免费。
 *
 * 支持的交易所:
 *   - Binance 合约: wss://fstream.binance.com/ws/!miniTicker@arr
 */

import WebSocket from 'ws'
import {HttpsProxyAgent} from 'https-proxy-agent'
import ccxt from 'ccxt'
import {config} from '../config.js'

type TickerCallback = (
  tickers: Array<{
    symbol: string
    price: string
    open: string
    change: string
    volume: string
    quoteVol: string
    high: string
    low: string
  }>
) => void

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let subscribers = new Set<TickerCallback>()

/** 一次性通过 REST 拉取全量 ticker 并推给订阅者 */
async function fetchAllTickers() {
  try {
    const exchange = new ccxt.binance({
      enableRateLimit: true,
      timeout: 30000,
      options: {defaultType: 'swap'}
    })
    if (config.HTTPS_PROXY) {
      exchange.httpsProxy = config.HTTPS_PROXY
    }
    await exchange.loadMarkets()
    const tickers = await exchange.fetchTickers()
    const result: Array<{
      symbol: string
      price: string
      open: string
      change: string
      volume: string
      quoteVol: string
      high: string
      low: string
    }> = []

    for (const [symbol, t] of Object.entries(tickers)) {
      if (!t.last || !t.open) continue
      // 只保留 USDT 永续 (symbol 格式如 BTC/USDT:USDT)
      if (!symbol.endsWith('/USDT:USDT')) continue
      const change = t.open > 0 ? ((t.last - t.open) / t.open) * 100 : 0
      result.push({
        symbol: symbol.replace('/USDT:USDT', 'USDT'),
        price: t.last.toFixed(8),
        open: t.open.toFixed(8),
        change: change.toFixed(2),
        volume: (t.baseVolume ?? 0).toFixed(2),
        quoteVol: (t.quoteVolume ?? 0).toFixed(2),
        high: (t.high ?? 0).toFixed(8),
        low: (t.low ?? 0).toFixed(8)
      })
    }

    if (result.length > 0) {
      console.log(`[wsTicker] REST 初始拉取 ${result.length} 个币种`)
      for (const cb of subscribers) {
        try {
          cb(result)
        } catch {}
      }
    }
  } catch (err) {
    console.error('[wsTicker] REST 初始拉取失败:', (err as Error).message)
  }
}

/** 启动 Binance 迷你 ticker 流 */
export function startBinanceTicker() {
  if (ws) return // 已连接

  // 先 REST 拉取全量
  fetchAllTickers()

  const connect = () => {
    const wsOptions = config.HTTPS_PROXY
      ? {agent: new HttpsProxyAgent(config.HTTPS_PROXY)}
      : undefined
    ws = new WebSocket(
      'wss://fstream.binance.com/ws/!miniTicker@arr',
      wsOptions
    )

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
          o: string
          h: string
          l: string
          v: string
          q: string
        }> = JSON.parse(data.toString())

        const tickers = raw.map(t => {
          const price = Number(t.c)
          const open = Number(t.o)
          const change = open > 0 ? ((price - open) / open) * 100 : 0
          return {
            symbol: t.s,
            price: t.c,
            open: t.o,
            change: change.toFixed(2),
            volume: t.v,
            quoteVol: t.q,
            high: t.h,
            low: t.l
          }
        })

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
