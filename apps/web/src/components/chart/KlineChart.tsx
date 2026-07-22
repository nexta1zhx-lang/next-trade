'use client'

import {useEffect, useRef, useCallback} from 'react'
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type Time
} from 'lightweight-charts'

interface KlineChartProps {
  symbol: string
  timeframe: string
  onChartReady?: (chart: IChartApi, candleSeries: ISeriesApi<'Candlestick'>) => void
}

export default function KlineChart({symbol, timeframe, onChartReady}: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const fetchKlines = useCallback(async () => {
    if (!symbol) return []
    try {
      const res = await fetch(
        `/api/symbols/${encodeURIComponent(symbol)}/klines?timeframe=${timeframe}&limit=200`
      )
      const json = await res.json()
      if (!json.success) return []
      return json.data as Array<{
        time: number; open: number; high: number; low: number; close: number; volume: number
      }>
    } catch {
      return []
    }
  }, [symbol, timeframe])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: {
        background: {type: ColorType.Solid, color: '#18181b'},
        textColor: '#a1a1aa'
      },
      grid: {
        vertLines: {color: '#27272a'},
        horzLines: {color: '#27272a'}
      },
      crosshair: {
        mode: 0
      },
      rightPriceScale: {
        borderColor: '#3f3f46'
      },
      timeScale: {
        borderColor: '#3f3f46',
        timeVisible: true,
        secondsVisible: false
      },
      width: container.clientWidth,
      height: 450
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444'
    })

    chartRef.current = chart
    seriesRef.current = candleSeries
    onChartReady?.(chart, candleSeries)

    // 加载数据
    fetchKlines().then(candles => {
      if (candles.length > 0) {
        candleSeries.setData(
          candles.map(c => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
          }))
        )
      }
    })

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({width: containerRef.current.clientWidth})
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      try { chart.remove() } catch {}
      chartRef.current = null
      seriesRef.current = null
    }
  }, [symbol])

  // timeframe 变化时只更新数据
  useEffect(() => {
    if (!seriesRef.current) return
    fetchKlines().then(candles => {
      if (candles.length > 0) {
        seriesRef.current!.setData(
          candles.map(c => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
          }))
        )
      }
    })
  }, [timeframe, fetchKlines])

  return (
    <div
      ref={containerRef}
      style={{width: '100%', height: 450}}
      className="rounded-lg overflow-hidden border border-gray-700"
    />
  )
}
