'use client'

import {useRef, useEffect, useCallback} from 'react'

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

const WS_BASE: string =
  (typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? '' // HTTPS 页面降级到同域相对路径，由 Caddy 代理
    : (typeof window !== 'undefined'
        ? process.env.NEXT_PUBLIC_API_URL
        : ''
      )?.replace(/^http/, 'ws')
  ) ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'ws://localhost:3001'
    : '')

/**
 * WebSocket 订阅全量 ticker 数据
 * 连接后端 /ws/ticker，服务端直连 Binance miniTicker 流
 */
export function useTickerWs(
  onTickers: (tickers: TickerData[]) => void,
  enabled = true
) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)

  const connect = useCallback(() => {
    if (!enabled) return

    const url = `${WS_BASE}/ws/ticker`
    const ws = new WebSocket(url)

    ws.onopen = () => {
      console.log('[ws ticker] connected')
      retryCountRef.current = 0
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const tickers: TickerData[] = JSON.parse(event.data)
        onTickers(tickers)
      } catch (err) {
        console.error('[ws ticker] parse error:', err)
      }
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!enabled || retryCountRef.current >= 5) return
      retryCountRef.current++
      const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000)
      reconnectRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      // 浏览器不暴露 WebSocket 错误详情，直接关闭触发重连
      ws.close()
    }

    wsRef.current = ws
  }, [enabled, onTickers])

  useEffect(() => {
    if (!enabled) return
    connect()
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect, enabled])
}
