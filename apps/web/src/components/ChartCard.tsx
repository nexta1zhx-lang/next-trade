'use client'

import {useEffect, useRef, memo} from 'react'
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData
} from 'lightweight-charts'
import type {PriceAlert} from '@nexttrade/shared'

interface ChartCardProps {
  symbol: string
  base: string
  dayHigh: number
  dayLow: number
  vwap: number
  lastPrice: number
  isSqueeze: boolean
  alert: PriceAlert | null // 当前告警（用于闪烁）
}

/**
 * 单个图表卡片
 * 使用 lightweight-charts Canvas 渲染，避免 React 重绘
 */
const ChartCard = memo(function ChartCard({
  symbol,
  base,
  dayHigh,
  dayLow,
  vwap,
  lastPrice,
  isSqueeze,
  alert
}: ChartCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  // 初始化图表（仅一次）
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 260,
      layout: {
        background: {color: '#18181b'},
        textColor: '#a1a1aa'
      },
      grid: {
        vertLines: {color: '#27272a'},
        horzLines: {color: '#27272a'}
      },
      crosshair: {
        mode: 0,
        vertLine: {color: '#3b82f6', style: 2},
        horzLine: {color: '#3b82f6', style: 2}
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: false,
        secondsVisible: false
      },
      rightPriceScale: {
        borderColor: '#27272a'
      }
    })

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e'
    })

    candleSeriesRef.current = candlestickSeries

    // Day High 线 (橙色)
    candlestickSeries.createPriceLine({
      price: dayHigh,
      color: '#f97316',
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: 'H'
    })

    // VWAP 线 (蓝色)
    candlestickSeries.createPriceLine({
      price: vwap,
      color: '#3b82f6',
      lineWidth: 1,
      lineStyle: 3, // dotted
      axisLabelVisible: true,
      title: 'VWAP'
    })

    chartRef.current = chart

    // 填充示例 K 线数据（实际应从 API 获取）
    const mockData = generateMockCandles(60, lastPrice)
    candlestickSeries.setData(mockData)

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({width: containerRef.current.clientWidth})
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 更新最新价格
  useEffect(() => {
    if (!candleSeriesRef.current) return
    const series = candleSeriesRef.current
    const data = series.data()
    if (data.length > 0) {
      const last = data[data.length - 1] as CandlestickData
      series.update({
        time: last.time,
        open: last.open,
        close: lastPrice,
        high: Math.max(last.high, lastPrice),
        low: Math.min(last.low, lastPrice)
      })
    }
  }, [lastPrice])

  // Day High / VWAP 变化时更新线条
  useEffect(() => {
    if (!candleSeriesRef.current) return
    const series = candleSeriesRef.current
    // lightweight-charts 不支持直接更新 priceLine，所以这里不做高频更新
  }, [dayHigh, vwap])

  const hasAlert = alert?.symbol === symbol
  const pulseClass = hasAlert
    ? alert.type === 'breakout'
      ? 'ring-2 ring-emerald-500 animate-pulse'
      : alert.type === 'squeeze_release'
        ? 'ring-2 ring-red-500 animate-pulse'
        : 'ring-2 ring-yellow-500 animate-pulse'
    : ''

  return (
    <div
      className={`rounded-xl border border-border bg-card overflow-hidden transition-all duration-300 ${pulseClass}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{base}</span>
          <span className="text-xs text-muted-foreground">
            {symbol.split(':')[0]}
          </span>
          {isSqueeze && (
            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
              SQZ
            </span>
          )}
        </div>
        <span className="text-sm font-mono tabular-nums text-foreground">
          {lastPrice < 1 ? lastPrice.toFixed(4) : lastPrice.toFixed(2)}
        </span>
      </div>

      {/* Chart Canvas */}
      <div ref={containerRef} className="w-full" />
    </div>
  )
})

/**
 * 生成模拟 K 线数据（用于展示）
 */
function generateMockCandles(
  count: number,
  basePrice: number
): CandlestickData[] {
  const now = Math.floor(Date.now() / 1000)
  const data: CandlestickData[] = []
  let price = basePrice * 0.98

  for (let i = 0; i < count; i++) {
    const open = price
    const change = (Math.random() - 0.48) * price * 0.02
    const close = open + change
    const high = Math.max(open, close) + Math.random() * price * 0.01
    const low = Math.min(open, close) - Math.random() * price * 0.01
    price = close

    data.push({
      time: (now - (count - i) * 60) as any,
      open,
      high,
      low,
      close
    })
  }

  return data
}

export {ChartCard}
