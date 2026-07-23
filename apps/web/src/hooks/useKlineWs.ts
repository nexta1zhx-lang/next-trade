'use client'

import {useRef, useEffect, useCallback} from 'react'
import type {ISeriesApi, Time} from 'lightweight-charts'
import {WS_BASE} from '@/lib/api'

interface KlineMsg {
  e: 'kline'
  E: number
  s: string
  k: {
    t: number
    o: string
    h: string
    l: string
    c: string
    x: boolean
  }
}

/** 对齐到图表周期边界（毫秒） */
function alignTime(ts: number, tf: string): number {
  switch (tf) {
    case '1m':
      return Math.floor(ts / 60000) * 60000
    case '3m':
      return Math.floor(ts / 180000) * 180000
    case '5m':
      return Math.floor(ts / 300000) * 300000
    case '15m':
      return Math.floor(ts / 900000) * 900000
    case '30m':
      return Math.floor(ts / 1800000) * 1800000
    case '1h':
      return Math.floor(ts / 3600000) * 3600000
    case '2h':
      return Math.floor(ts / 7200000) * 7200000
    case '4h':
      return Math.floor(ts / 14400000) * 14400000
    default:
      return Math.floor(ts / 3600000) * 3600000
  }
}

/** 订阅 1 分钟 K 线流，合并到图表周期后更新 */
export function useKlineWs(
  symbol: string | null,
  timeframe: string,
  seriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>,
  enabled: boolean,
  allDataRef?: React.MutableRefObject<
    Array<{
      time: number
      open: number
      high: number
      low: number
      close: number
    }>
  >
) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)

  const connect = useCallback(() => {
    if (!symbol || !enabled || !seriesRef.current) return

    const url = `${WS_BASE}/ws?symbol=${encodeURIComponent(symbol)}`
    const ws = new WebSocket(url)

    ws.onopen = () => {
      console.log(`[kline WS] connected: ${symbol}`)
      retryCountRef.current = 0
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: KlineMsg = JSON.parse(event.data)
        if (msg.e !== 'kline') return
        const k = msg.k

        const candleTime = alignTime(k.t, timeframe) // 归入的图表周期 (ms)
        const cs = seriesRef.current
        if (!cs) return

        const timeS = Math.floor(candleTime / 1000) // 秒
        const high = Number(k.h)
        const low = Number(k.l)
        const close = Number(k.c)
        const open = Number(k.o)

        // 查 allDataRef 最后一根
        const last = allDataRef?.current?.[allDataRef.current.length - 1]
        const samePeriod = last && Math.floor(last.time) === timeS

        if (samePeriod) {
          // 同周期 → 合并
          last.high = Math.max(last.high, high)
          last.low = Math.min(last.low, low)
          last.close = close
          cs.update({
            time: timeS as Time,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close
          })
        } else {
          // 新周期 → 用 allDataRef 已有数据(如有)或 1m 的 open
          const existing = allDataRef?.current?.find(
            c => Math.floor(c.time) === timeS
          )
          const useOpen = existing ? existing.open : open
          if (allDataRef?.current) {
            allDataRef.current.push({
              time: timeS,
              open: useOpen,
              high,
              low,
              close
            })
          }
          cs.update({
            time: timeS as Time,
            open: useOpen,
            high,
            low,
            close
          })
        }
      } catch {}
    }

    ws.onclose = () => {
      wsRef.current = null
      if (retryCountRef.current >= 3) return
      retryCountRef.current++
      if (enabled && symbol) reconnectRef.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      wsRef.current?.close()
    }
    wsRef.current = ws
  }, [symbol, timeframe, enabled, seriesRef, allDataRef])

  useEffect(() => {
    if (!enabled || !symbol) return
    const timer = setTimeout(connect, 1000)
    return () => {
      clearTimeout(timer)
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect, enabled, symbol])
}
