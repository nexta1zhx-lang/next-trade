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

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CrosshairInfo {
  open: number
  high: number
  low: number
  close: number
  yPrice: number
  yPricePct: number
}

interface KlineChartProps {
  symbol: string
  timeframe: string
  onChartReady?: (
    chart: IChartApi,
    candleSeries: ISeriesApi<'Candlestick'>
  ) => void
  onCrosshairChange?: (info: CrosshairInfo | null) => void
  refreshInterval?: number
  height?: number
}

const PAGE_SIZE = 300

/** 不同周期每根 K 线对应的毫秒数 */
function tfMs(tf: string): number {
  switch (tf) {
    case '15m':
      return 15 * 60 * 1000
    case '1h':
      return 3600 * 1000
    case '4h':
      return 4 * 3600 * 1000
    case '1d':
      return 86400 * 1000
    default:
      return 3600 * 1000
  }
}

export default function KlineChart({
  symbol,
  timeframe,
  onChartReady,
  onCrosshairChange,
  refreshInterval = 30000,
  height = 320
}: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const allDataRef = useRef<Candle[]>([])
  const loadingRef = useRef(false)
  const disposedRef = useRef(false)
  const yLabelRef = useRef<HTMLDivElement>(null)

  const fetchKlines = useCallback(
    async (since?: number): Promise<Candle[]> => {
      if (!symbol) return []
      try {
        const params = new URLSearchParams({
          timeframe,
          limit: String(PAGE_SIZE)
        })
        if (since) params.set('since', String(since))
        const res = await fetch(
          `/api/symbols/${encodeURIComponent(symbol)}/klines?${params}`
        )
        const json = await res.json()
        if (!json.success) return []
        return json.data as Candle[]
      } catch {
        return []
      }
    },
    [symbol, timeframe]
  )

  const loadMore = useCallback(async () => {
    if (
      loadingRef.current ||
      allDataRef.current.length === 0 ||
      disposedRef.current
    )
      return
    loadingRef.current = true
    const oldest = allDataRef.current[0]
    const sinceMs = oldest.time * 1000 - PAGE_SIZE * tfMs(timeframe)
    const more = await fetchKlines(sinceMs)
    if (more.length > 0 && !disposedRef.current) {
      const existingTimes = new Set(allDataRef.current.map(c => c.time))
      const newOnes = more.filter(c => !existingTimes.has(c.time))
      if (newOnes.length > 0) {
        allDataRef.current = [...newOnes, ...allDataRef.current]
        seriesRef.current?.setData(
          allDataRef.current.map(c => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
          }))
        )
      }
    }
    loadingRef.current = false
  }, [fetchKlines, timeframe])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: {
        background: {type: ColorType.Solid, color: '#18181b'},
        textColor: '#a1a1aa'
      },
      grid: {vertLines: {color: '#27272a'}, horzLines: {color: '#27272a'}},
      crosshair: {
        mode: 0,
        vertLine: {labelVisible: false},
        horzLine: {labelVisible: true, labelBackgroundColor: '#27272a'}
      },
      rightPriceScale: {
        borderColor: '#3f3f46',
        scaleMargins: {top: 0.1, bottom: 0.15},
        entireTextOnly: true,
        minimumWidth: 60
      },
      localization: {
        priceFormatter: (price: number) => {
          if (price >= 1000) return price.toFixed(2)
          if (price >= 1) return price.toFixed(4)
          if (price >= 0.01) return price.toFixed(6)
          return price.toFixed(8)
        },
        timeFormatter: (time: number) => {
          const d = new Date(time * 1000)
          return d.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Shanghai'
          })
        }
      },
      timeScale: {
        borderColor: '#3f3f46',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000)
          return d.toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Shanghai'
          })
        }
      },
      width: container.clientWidth,
      height
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

    // K 线悬停 → 回调给父组件 + 更新 Y 轴价格线
    const crosshairHandler: Parameters<
      typeof chart.subscribeCrosshairMove
    >[0] = param => {
      const point = param.point
      const lastCandle = allDataRef.current[allDataRef.current.length - 1]

      // 更新 Y 轴价格标签
      const label = yLabelRef.current
      if (point && lastCandle && label) {
        const yPrice = candleSeries.coordinateToPrice(point.y)
        if (yPrice !== null) {
          const pct = ((yPrice - lastCandle.close) / lastCandle.close) * 100
          const sign = pct >= 0 ? '+' : ''
          const color = pct >= 0 ? '#22c55e' : '#ef4444'
          label.innerHTML = `<div style="text-align:right;line-height:1.4">${yPrice.toFixed(4)}<br><span style="color:${color}">${sign}${pct.toFixed(2)}%</span></div>`
          label.style.display = 'block'
          label.style.top = Math.max(point.y - 8, 0) + 'px'
        } else {
          label.style.display = 'none'
        }
      } else if (label) {
        label.style.display = 'none'
      }

      // 回调父组件（K 线信息）
      if (!onCrosshairChange) return
      const data = param.seriesData.get(candleSeries) as
        | {time: Time; open: number; high: number; low: number; close: number}
        | undefined
      if (data && point) {
        const yPrice = candleSeries.coordinateToPrice(point.y)
        const yPricePct =
          yPrice !== null && lastCandle
            ? ((yPrice - lastCandle.close) / lastCandle.close) * 100
            : 0
        onCrosshairChange({
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          yPrice: yPrice ?? data.close,
          yPricePct
        })
      } else if (point && lastCandle) {
        const yPrice = candleSeries.coordinateToPrice(point.y)
        if (yPrice !== null) {
          const yPricePct =
            ((yPrice - lastCandle.close) / lastCandle.close) * 100
          onCrosshairChange({
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            yPrice,
            yPricePct
          })
        } else {
          onCrosshairChange(null)
        }
      } else {
        onCrosshairChange(null)
      }
    }
    chart.subscribeCrosshairMove(crosshairHandler)

    // 在图表初始化后立即挂载滚动监听（解决 ref 不触发 re-render 的问题）
    const timeScale = chart.timeScale()
    const scrollHandler = (
      range: import('lightweight-charts').LogicalRange | null
    ) => {
      if (
        range &&
        range.from <= 3 &&
        !loadingRef.current &&
        allDataRef.current.length > 0
      ) {
        loadMore()
      }
    }
    timeScale.subscribeVisibleLogicalRangeChange(scrollHandler)

    // 初始加载
    const load = () =>
      fetchKlines().then(candles => {
        if (candles.length > 0 && !disposedRef.current) {
          allDataRef.current = candles
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
    load()

    let timer: ReturnType<typeof setInterval> | null = null
    if (refreshInterval > 0) timer = setInterval(load, refreshInterval)

    const handleResize = () => {
      if (containerRef.current)
        chart.applyOptions({width: containerRef.current.clientWidth})
    }
    window.addEventListener('resize', handleResize)

    return () => {
      disposedRef.current = true
      chart.unsubscribeCrosshairMove(crosshairHandler)
      timeScale.unsubscribeVisibleLogicalRangeChange(scrollHandler)
      window.removeEventListener('resize', handleResize)
      if (timer) clearInterval(timer)
      try {
        chart.remove()
      } catch {}
      chartRef.current = null
      seriesRef.current = null
      allDataRef.current = []
    }
  }, [symbol])

  // timeframe 变化时重新加载数据（图表不重建，只换数据）
  useEffect(() => {
    if (!seriesRef.current) return
    disposedRef.current = false
    allDataRef.current = []
    fetchKlines().then(candles => {
      if (candles.length > 0 && seriesRef.current && !disposedRef.current) {
        allDataRef.current = candles
        seriesRef.current.setData(
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
    <div className="relative">
      <div
        ref={containerRef}
        style={{width: '100%', height}}
        className="rounded-lg overflow-hidden border border-gray-700"
      />
      <div
        ref={yLabelRef}
        className="absolute hidden pointer-events-none z-50
                   text-[11px] font-mono leading-none px-1.5 py-1
                   bg-[#18181b]/90 border border-gray-700 rounded
                   whitespace-nowrap"
        style={{right: 0, top: 0}}
      />
    </div>
  )
}
