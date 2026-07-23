'use client'

import {useEffect, useRef, useCallback} from 'react'
import {useUserConfig} from '@/hooks/useUserConfig'
import {useKlineWs} from '@/hooks/useKlineWs'
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

/** 价格精度格式化（与 Y 轴标签保持一致） */
function fmtPrice(price: number): string {
  if (price >= 1000) return price.toFixed(1)
  if (price >= 1) return price.toFixed(3)
  if (price >= 0.01) return price.toFixed(5)
  return price.toFixed(7)
}

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
  refreshInterval: refreshIntervalProp,
  height = 320
}: KlineChartProps) {
  const userConfig = useUserConfig()
  const refreshInterval = refreshIntervalProp ?? userConfig.klineInterval

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const allDataRef = useRef<Candle[]>([])

  // WS 实时 K 线（仅 klineMode='ws' 时生效）
  useKlineWs(
    symbol,
    timeframe,
    seriesRef,
    userConfig.klineMode === 'ws',
    allDataRef
  )
  const loadingRef = useRef(false)
  const disposedRef = useRef(false)
  const refreshIntervalRef = useRef(refreshInterval)
  refreshIntervalRef.current = refreshInterval
  const yLabelRef = useRef<HTMLDivElement>(null)
  const xLabelRef = useRef<HTMLDivElement>(null)

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
    try {
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
    } catch {}
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
        scaleMargins: {top: 0.08, bottom: 0.1},
        minimumWidth: 80
      },
      localization: {
        priceFormatter: fmtPrice,
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
        rightOffset: 5,
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          const d = new Date(time * 1000)
          // tickMarkType: 0=Year 1=Month 2=Day 3=Hour 4=Minute
          if (tickMarkType <= 2) {
            // 日期级别 → 显示月/日
            return d.toLocaleString('zh-CN', {
              month: 'short',
              day: 'numeric',
              timeZone: 'Asia/Shanghai'
            })
          }
          // 时间级别 → 只显示时:分
          return d.toLocaleString('zh-CN', {
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
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 8,
        minMove: 0.00000001
      }
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
          label.innerHTML = `<div style="text-align:right;line-height:1.4">${fmtPrice(yPrice)}<br><span style="color:${color}">${sign}${pct.toFixed(1)}%</span></div>`
          label.style.display = 'block'
          label.style.top = Math.max(point.y - 8, 0) + 'px'
        } else {
          label.style.display = 'none'
        }
      } else if (label) {
        label.style.display = 'none'
      }

      // 更新 X 轴时间标签
      const xLabel = xLabelRef.current
      if (point && xLabel) {
        const time = param.time as number | undefined
        if (time) {
          const d = new Date(time * 1000)
          const fmt = d.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Shanghai'
          })
          xLabel.textContent = fmt
          xLabel.style.display = 'block'
          xLabel.style.left = Math.max(point.x - 60, 0) + 'px'
        } else {
          xLabel.style.display = 'none'
        }
      } else if (xLabel) {
        xLabel.style.display = 'none'
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
      try {
        chart.remove()
      } catch {}
      chartRef.current = null
      seriesRef.current = null
      allDataRef.current = []
    }
  }, [symbol])

  // timeframe 变化时重新加载数据（图表不重建，只换数据）
  // 注意：初次挂载时不执行，数据由 useEffect([symbol]) 中的 load() 加载
  const isMountedRef = useRef(false)
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      return
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe])

  // 同步 height 变化到 chart 实例
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({height})
    }
  }, [height])

  // 定时轮询刷新（WS 模式下关闭轮询）
  useEffect(() => {
    if (refreshInterval <= 0 || userConfig.klineMode === 'ws') return
    const timer = setInterval(async () => {
      if (!seriesRef.current || disposedRef.current) return
      try {
        const candles = await fetchKlines()
        if (candles.length > 0 && !disposedRef.current) {
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
      } catch {}
    }, refreshInterval)
    return () => clearInterval(timer)
  }, [refreshInterval, fetchKlines])

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
                   bg-[#18181b] border border-gray-700 rounded
                   whitespace-nowrap"
        style={{right: 0, top: 0, minWidth: 80}}
      />
      <div
        ref={xLabelRef}
        className="absolute hidden pointer-events-none z-50
                   text-[11px] font-mono px-1.5 py-0.5
                   bg-[#18181b]/90 border border-gray-700 rounded
                   whitespace-nowrap"
        style={{bottom: 4, left: 0}}
      />
    </div>
  )
}
