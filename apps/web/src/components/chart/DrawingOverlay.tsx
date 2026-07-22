'use client'

import {useRef, useEffect, useCallback} from 'react'
import type {IChartApi, ISeriesApi, Time} from 'lightweight-charts'

export interface TrendLine {
  id: string
  startTime: number
  startPrice: number
  endTime: number
  endPrice: number
}

interface DrawingOverlayProps {
  chart: IChartApi | null
  candleSeries: ISeriesApi<'Candlestick'> | null
  activeTool: 'horizontal' | 'trendline' | null
  trendLines: TrendLine[]
  onAddTrendLine: (line: Omit<TrendLine, 'id'>) => void
}

export default function DrawingOverlay({
  chart,
  candleSeries,
  activeTool,
  trendLines,
  onAddTrendLine
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const drawLines = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !chart || !candleSeries) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const timeScale = chart.timeScale()

    for (const line of trendLines) {
      const x1 = timeScale.timeToCoordinate(line.startTime as Time)
      const x2 = timeScale.timeToCoordinate(line.endTime as Time)
      const y1 = candleSeries.priceToCoordinate(line.startPrice)
      const y2 = candleSeries.priceToCoordinate(line.endPrice)

      if (x1 === null || x2 === null || y1 === null || y2 === null) continue

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }, [chart, candleSeries, trendLines])

  useEffect(() => {
    if (!chart) return
    const timeScale = chart.timeScale()
    timeScale.subscribeVisibleTimeRangeChange(drawLines)
    timeScale.subscribeVisibleLogicalRangeChange(drawLines)
    return () => {
      timeScale.unsubscribeVisibleTimeRangeChange(drawLines)
      timeScale.unsubscribeVisibleLogicalRangeChange(drawLines)
    }
  }, [chart, drawLines])

  useEffect(() => {
    drawLines()
  }, [trendLines, drawLines])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !chart) return

    const container = canvas.parentElement
    if (!container) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = rect.height * window.devicePixelRatio
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'
      drawLines()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)

    resize()
    return () => observer.disconnect()
  }, [chart, drawLines])

  const getChartCoords = useCallback(
    (e: React.MouseEvent) => {
      if (!chart || !candleSeries || !canvasRef.current) return null
      const rect = canvasRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const time = chart.timeScale().coordinateToTime(x)
      const price = candleSeries.coordinateToPrice(y)
      if (time === null || price === null) return null
      return {time: time as number, price}
    },
    [chart, candleSeries]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool === 'trendline') {
        const start = getChartCoords(e)
        if (!start) return

        const handleMouseUp = (ue: MouseEvent) => {
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('mouseup', handleMouseUp)
          const end = getChartCoords({clientX: ue.clientX, clientY: ue.clientY} as React.MouseEvent)
          if (!end) return
          onAddTrendLine({
            startTime: start.time,
            startPrice: start.price,
            endTime: end.time,
            endPrice: end.price
          })
        }

        const handleMouseMove = (me: MouseEvent) => {
          me.preventDefault()
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
      }
    },
    [activeTool, getChartCoords, onAddTrendLine]
  )

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10"
      style={{
        pointerEvents: activeTool ? 'auto' : 'none',
        cursor: activeTool === 'trendline' ? 'crosshair' : activeTool === 'horizontal' ? 'crosshair' : undefined
      }}
      onMouseDown={handleMouseDown}
    />
  )
}
