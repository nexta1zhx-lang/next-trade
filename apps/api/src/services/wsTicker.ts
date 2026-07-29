/**
 * WebSocket 行情推送服务 — 直连 Binance USDⓈ-M 永续合约版
 *
 * 使用 ws 库直连 Binance USDⓈ-M 期货公共 WebSocket (!miniTicker@arr)，
 * 仅接收 USDT 永续合约的 ticker，不会混入现货数据。
 * 收到 ticker 后格式化并通过 subscribers 推送给前端 WebSocket。
 *
 * URL: wss://fstream.binance.com/market/ws/!miniTicker@arr
 * 数据格式(单流): [{e:"24hrMiniTicker",E:...,s:"BTCUSDT",c:"...",o:"...",...}, ...]
 */

import WebSocket from 'ws'
import {fetchAllTickers} from './binance.js'

// ─── 类型 ───

export interface TickerData {
  symbol: string
  price: string
  open: string
  change: string
  volume: string
  quoteVol: string
  high: string
  low: string
}

type TickerCallback = (tickers: TickerData[]) => void

/** Binance miniTicker 24hr 原始数据项 */
interface MiniTickerRaw {
  e: string
  E: number
  s: string
  c: string
  o: string
  h: string
  l: string
  v: string
  q: string
}

// ─── 状态 ───

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let subscribers = new Set<TickerCallback>()

// 最大订阅者数，超过后拒绝新订阅（防止内存泄漏）
const MAX_SUBSCRIBERS = 100

const WS_URL = 'wss://fstream.binance.com/market/ws/!miniTicker@arr'
const RECONNECT_DELAY = 5000

// ─── 工具 ───

/** 将 Binance miniTicker 数据格式化为统一 TickerData */
function formatTickers(raw: MiniTickerRaw[]): TickerData[] {
  return raw.map(t => {
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
}

/** 推数据给所有订阅者 */
function broadcast(tickers: TickerData[]) {
  for (const cb of subscribers) {
    try {
      cb(tickers)
    } catch {}
  }
}

// ─── REST 初始拉取（快照） ───

async function fetchAllBinanceTickers() {
  try {
    const tickers = await fetchAllTickers()
    const result: TickerData[] = []

    for (const t of tickers) {
      const price = parseFloat(t.price)
      const open = price / (1 + parseFloat(t.changePct) / 100)
      if (!price || !open) continue
      const change = open > 0 ? ((price - open) / open) * 100 : 0
      result.push({
        symbol: t.symbol,
        price: t.price,
        open: open.toFixed(8),
        change: change.toFixed(2),
        volume: t.volume,
        quoteVol: t.quoteVol,
        high: t.high,
        low: t.low
      })
    }

    if (result.length > 0) {
      console.log(`[wsTicker] REST 初始拉取 ${result.length} 个币种`)
      broadcast(result)
    }
  } catch (err) {
    console.error('[wsTicker] REST 初始拉取失败:', (err as Error).message)
  }
}

// ─── WS 消息处理 ───

/** 处理 Binance 推送的 miniTicker 原始数据 */
function handleMessage(data: WebSocket.Data) {
  try {
    const raw = JSON.parse(data.toString())
    // 单流 !miniTicker@arr 直接返回数组
    if (Array.isArray(raw)) {
      broadcast(formatTickers(raw as MiniTickerRaw[]))
    }
  } catch {}
}

// ─── WS 连接管理 ───

/** 创建 WebSocket 连接 */
function createConnection() {
  if (ws) cleanup()

  ws = new WebSocket(WS_URL)

  ws.on('open', () => {
    console.log('[wsTicker] WebSocket connected')
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  })

  ws.on('message', handleMessage)

  ws.on('close', () => {
    console.log('[wsTicker] WebSocket closed')
    ws = null
    scheduleReconnect()
  })

  ws.on('error', err => {
    console.error('[wsTicker] WebSocket error:', err.message)
  })
}

/** 清理当前连接 */
function cleanup() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.removeAllListeners()
    ws.on('error', () => {}) // close() 前挂 error 处理器，防止连接未建立时触发未捕获异常
    ws.close()
    ws = null
  }
}

/** 调度断线重连 */
function scheduleReconnect() {
  if (subscribers.size === 0) return
  if (reconnectTimer) return
  console.log(`[wsTicker] ${RECONNECT_DELAY}ms 后重连...`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    createConnection()
  }, RECONNECT_DELAY)
}

// ─── 公开 API ───

/** 启动 Binance WebSocket 迷你 ticker 流 */
export function startBinanceTicker() {
  if (ws?.readyState === WebSocket.OPEN) return // 已连接

  // 先 REST 拉取全量快照
  fetchAllBinanceTickers()

  createConnection()
}

/** 停止连接 */
export function stopBinanceTicker() {
  cleanup()
}

/** 订阅 ticker 推送 */
export function subscribeTicker(cb: TickerCallback): () => void {
  if (subscribers.size >= MAX_SUBSCRIBERS) {
    console.warn(`[wsTicker] 订阅者已达上限(${MAX_SUBSCRIBERS})，拒绝新订阅`)
    return () => {}
  }
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
    if (subscribers.size === 0) stopBinanceTicker()
  }
}
