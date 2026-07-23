'use client'

import {useRef, useEffect, useCallback, useState} from 'react'
import type {IChartApi, ISeriesApi, Time} from 'lightweight-charts'

export interface TrendLine {
  id: string
  type: 'horizontal' | 'trendline' | 'vertical'
  time1: number
  price1: number
  time2?: number
  price2?: number
}

interface DrawingOverlayProps {
  chart: IChartApi | null
  candleSeries: ISeriesApi<'Candlestick'> | null
  activeTool: 'cursor' | 'horizontal' | 'trendline' | 'vertical'
  drawings: TrendLine[]
  onAddDrawing: (line: Omit<TrendLine, 'id'>) => void
  onDeleteDrawing: (id: string) => void
  onUpdateDrawing?: (
    id: string,
    updates: Partial<Omit<TrendLine, 'id'>>
  ) => void
  onClearAll: () => void
  onToolChange?: (
    tool: 'cursor' | 'horizontal' | 'trendline' | 'vertical'
  ) => void
}

type DragTarget =
  | {id: string; type: 'line'}
  | {id: string; type: 'start'}
  | {id: string; type: 'end'}
  | null

function hitTestEndpoint(
  d: TrendLine,
  mx: number,
  my: number,
  chart: IChartApi,
  cs: ISeriesApi<'Candlestick'>
): 'start' | 'end' | null {
  if (d.type !== 'trendline' || d.time2 == null) return null
  const ts = chart.timeScale()
  const px1 = ts.timeToCoordinate(d.time1 as Time)
  const py1 = cs.priceToCoordinate(d.price1)
  const px2 = ts.timeToCoordinate(d.time2 as Time)
  const py2 = cs.priceToCoordinate(d.price2 ?? d.price1)
  if (px1 === null || py1 === null || px2 === null || py2 === null) return null
  if (Math.abs(mx - px1) < 10 && Math.abs(my - py1) < 10) return 'start'
  if (Math.abs(mx - px2) < 10 && Math.abs(my - py2) < 10) return 'end'
  return null
}

function hitTest(
  d: TrendLine,
  mx: number,
  my: number,
  chart: IChartApi,
  cs: ISeriesApi<'Candlestick'>
): boolean {
  const ts = chart.timeScale()
  if (d.type === 'horizontal') {
    const py = cs.priceToCoordinate(d.price1)
    return py !== null && Math.abs(my - py) < 8
  }
  if (d.type === 'vertical') {
    const px = ts.timeToCoordinate(d.time1 as Time)
    return px !== null && Math.abs(mx - px) < 8
  }
  if (d.type === 'trendline' && d.time2 != null) {
    const px1 = ts.timeToCoordinate(d.time1 as Time)
    const py1 = cs.priceToCoordinate(d.price1)
    const px2 = ts.timeToCoordinate(d.time2 as Time)
    const py2 = cs.priceToCoordinate(d.price2 ?? d.price1)
    if (px1 === null || py1 === null || px2 === null || py2 === null)
      return false
    const dist =
      Math.abs((py2 - py1) * mx - (px2 - px1) * my + px2 * py1 - py2 * px1) /
      Math.sqrt((py2 - py1) ** 2 + (px2 - px1) ** 2)
    return dist < 10
  }
  return false
}

export default function DrawingOverlay({
  chart,
  candleSeries,
  activeTool,
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onToolChange
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const p1Ref = useRef<{time: number; price: number} | null>(null)
  const p2Ref = useRef<{time: number; price: number} | null>(null)
  const dragRef = useRef<DragTarget>(null)
  const dragStartRef = useRef<{
    mx: number
    my: number
    time1: number
    price1: number
    time2?: number
    price2?: number
  } | null>(null)
  const [hovered, setHovered] = useState<TrendLine | null>(null)
  const [hoverPos, setHoverPos] = useState<{x: number; y: number} | null>(null)
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c || !chart || !candleSeries) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    const ts = chart.timeScale()

    for (const d of drawings) {
      const isH = hovered?.id === d.id
      if (d.type === 'horizontal') {
        const y = candleSeries.priceToCoordinate(d.price1)
        if (y === null) continue
        const py = y * dpr
        ctx.beginPath()
        ctx.moveTo(0, py)
        ctx.lineTo(c.width, py)
        ctx.strokeStyle = isH ? '#60a5fa' : '#3b82f6'
        ctx.lineWidth = (isH ? 2.5 : 1.5) * dpr
        ctx.setLineDash([4 * dpr, 4 * dpr])
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = isH ? '#60a5fa' : '#3b82f6'
        ctx.font = `${11 * dpr}px monospace`
        ctx.fillText(d.price1.toFixed(4), 4 * dpr, py - 4 * dpr)
      } else if (d.type === 'vertical') {
        const x = ts.timeToCoordinate(d.time1 as Time)
        if (x === null) continue
        const px = x * dpr
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, c.height)
        ctx.strokeStyle = isH ? '#fbbf24' : '#f59e0b'
        ctx.lineWidth = (isH ? 2.5 : 1.5) * dpr
        ctx.setLineDash([4 * dpr, 4 * dpr])
        ctx.stroke()
        ctx.setLineDash([])
      } else if (d.type === 'trendline' && d.time2 != null) {
        const x1 = ts.timeToCoordinate(d.time1 as Time)
        const x2 = ts.timeToCoordinate(d.time2 as Time)
        const y1 = candleSeries.priceToCoordinate(d.price1)
        const y2 = candleSeries.priceToCoordinate(d.price2 ?? d.price1)
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue
        ctx.beginPath()
        ctx.moveTo(x1 * dpr, y1 * dpr)
        ctx.lineTo(x2 * dpr, y2 * dpr)
        ctx.strokeStyle = isH ? '#fde68a' : '#fbbf24'
        ctx.lineWidth = (isH ? 3 : 2) * dpr
        ctx.stroke()
      }
    }
    // trendline preview
    if (p1Ref.current && p2Ref.current) {
      const x1 = ts.timeToCoordinate(p1Ref.current.time as Time)
      const y1 = candleSeries.priceToCoordinate(p1Ref.current.price)
      const x2 = ts.timeToCoordinate(p2Ref.current.time as Time)
      const y2 = candleSeries.priceToCoordinate(p2Ref.current.price)
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        ctx.beginPath()
        ctx.arc(x1 * dpr, y1 * dpr, 4 * dpr, 0, 2 * Math.PI)
        ctx.fillStyle = '#fbbf24'
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(x1 * dpr, y1 * dpr)
        ctx.lineTo(x2 * dpr, y2 * dpr)
        ctx.strokeStyle = '#fbbf2480'
        ctx.lineWidth = 2 * dpr
        ctx.setLineDash([6 * dpr, 4 * dpr])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }, [chart, candleSeries, drawings, hovered])

  useEffect(() => {
    if (!chart || !candleSeries) return
    draw()
    const ts = chart.timeScale()
    const h = () => draw()
    ts.subscribeVisibleTimeRangeChange(h)
    ts.subscribeVisibleLogicalRangeChange(h)
    return () => {
      ts.unsubscribeVisibleTimeRangeChange(h)
      ts.unsubscribeVisibleLogicalRangeChange(h)
    }
  }, [chart, candleSeries, draw])
  useEffect(() => {
    draw()
  }, [drawings, draw, hovered])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !chart) return
    const p = c.parentElement
    if (!p) return
    const fn = () => {
      const r = p.getBoundingClientRect()
      c.width = r.width * dpr
      c.height = r.height * dpr
      c.style.width = r.width + 'px'
      c.style.height = r.height + 'px'
      draw()
    }
    const o = new ResizeObserver(fn)
    o.observe(p)
    fn()
    return () => o.disconnect()
  }, [chart, draw])

  const getCoords = useCallback(
    (cx: number, cy: number) => {
      if (!chart || !candleSeries || !canvasRef.current) return null
      const r = canvasRef.current.getBoundingClientRect()
      const x = cx - r.left
      const y = cy - r.top
      const t = chart.timeScale().coordinateToTime(x)
      const p = candleSeries.coordinateToPrice(y)
      return t === null || p === null ? null : {time: t as number, price: p}
    },
    [chart, candleSeries]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!chart || !candleSeries || !canvasRef.current) return
      const r = canvasRef.current.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top

      // 画新线
      if (activeTool !== 'cursor') {
        const coords = getCoords(e.clientX, e.clientY)
        if (!coords) return
        if (activeTool === 'horizontal' || activeTool === 'vertical') {
          onAddDrawing({
            type: activeTool,
            time1: coords.time,
            price1: coords.price
          })
        } else if (activeTool === 'trendline') {
          if (!p1Ref.current) {
            p1Ref.current = coords
          } else {
            const s = p1Ref.current
            if (
              Math.abs(coords.time - s.time) > 3 ||
              Math.abs(coords.price - s.price) > 0.0001
            ) {
              onAddDrawing({
                type: 'trendline',
                time1: s.time,
                price1: s.price,
                time2: coords.time,
                price2: coords.price
              })
            }
            p1Ref.current = null
            p2Ref.current = null
            onToolChange?.('cursor')
          }
        }
        return
      }

      // cursor 模式：拖拽已有图形
      for (const d of drawings) {
        if (d.type === 'trendline' && d.time2 != null) {
          const ep = hitTestEndpoint(d, mx, my, chart, candleSeries)
          if (ep) {
            dragRef.current = {id: d.id, type: ep}
            dragStartRef.current = {
              mx,
              my,
              time1: d.time1,
              price1: d.price1,
              time2: d.time2,
              price2: d.price2
            }
            return
          }
        }
        if (hitTest(d, mx, my, chart, candleSeries)) {
          dragRef.current = {id: d.id, type: 'line'}
          dragStartRef.current = {
            mx,
            my,
            time1: d.time1,
            price1: d.price1,
            time2: d.time2,
            price2: d.price2
          }
          return
        }
      }
    },
    [
      activeTool,
      getCoords,
      onAddDrawing,
      onToolChange,
      chart,
      candleSeries,
      drawings
    ]
  )

  // global mousemove: hover + trendline preview + drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!chart || !candleSeries || !canvasRef.current) return
      const r = canvasRef.current.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top

      // 拖拽中
      if (dragRef.current && dragStartRef.current) {
        const drag = dragRef.current
        const start = dragStartRef.current
        const d = drawings.find(dd => dd.id === drag.id)
        if (!d) return
        const ts = chart.timeScale()
        // 计算偏移
        if (drag.type === 'line') {
          const dt = ts.coordinateToTime(mx)
          const dp = candleSeries.coordinateToPrice(my)
          const st = ts.coordinateToTime(start.mx)
          const sp = candleSeries.coordinateToPrice(start.my)
          if (dt === null || dp === null || st === null || sp === null) return
          const offsetT = (dt as number) - (st as number)
          const offsetP = dp - sp
          const updates: Partial<Omit<TrendLine, 'id'>> = {
            time1: start.time1 + offsetT,
            price1: start.price1 + offsetP
          }
          if (start.time2 != null) {
            updates.time2 = start.time2 + offsetT
            updates.price2 = (start.price2 ?? start.price1) + offsetP
          }
          onUpdateDrawing?.(drag.id, updates)
        } else if (drag.type === 'start') {
          const t = ts.coordinateToTime(mx)
          const p = candleSeries.coordinateToPrice(my)
          if (t !== null && p !== null) {
            onUpdateDrawing?.(drag.id, {time1: t as number, price1: p})
          }
        } else if (drag.type === 'end') {
          const t = ts.coordinateToTime(mx)
          const p = candleSeries.coordinateToPrice(my)
          if (t !== null && p !== null) {
            onUpdateDrawing?.(drag.id, {time2: t as number, price2: p})
          }
        }
        return
      }

      // hover
      let found: TrendLine | null = null
      for (const d of drawings) {
        if (hitTest(d, mx, my, chart, candleSeries)) {
          found = d
          break
        }
      }
      setHovered(found)
      setHoverPos(found ? {x: e.clientX, y: e.clientY - 40} : null)
      if (activeTool === 'trendline' && p1Ref.current) {
        const coords = getCoords(e.clientX, e.clientY)
        if (coords) {
          p2Ref.current = coords
          draw()
        }
      }
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [
    chart,
    candleSeries,
    drawings,
    activeTool,
    getCoords,
    draw,
    onUpdateDrawing
  ])

  // global mousedown: cursor 模式下点击已有图形开始拖拽
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        activeTool !== 'cursor' ||
        !chart ||
        !candleSeries ||
        !canvasRef.current
      )
        return
      const r = canvasRef.current.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      for (const d of drawings) {
        if (d.type === 'trendline' && d.time2 != null) {
          const ep = hitTestEndpoint(d, mx, my, chart, candleSeries)
          if (ep) {
            dragRef.current = {id: d.id, type: ep}
            dragStartRef.current = {
              mx,
              my,
              time1: d.time1,
              price1: d.price1,
              time2: d.time2,
              price2: d.price2
            }
            return
          }
        }
        if (hitTest(d, mx, my, chart, candleSeries)) {
          dragRef.current = {id: d.id, type: 'line'}
          dragStartRef.current = {
            mx,
            my,
            time1: d.time1,
            price1: d.price1,
            time2: d.time2,
            price2: d.price2
          }
          return
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [activeTool, chart, candleSeries, drawings])

  // global mouseup: 结束拖拽
  useEffect(() => {
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null
        dragStartRef.current = null
      }
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    if (activeTool !== 'trendline') {
      p1Ref.current = null
      p2Ref.current = null
    }
  }, [activeTool])

  const interactive = activeTool !== 'cursor'

  return (
    <div
      className="absolute inset-0"
      style={{pointerEvents: interactive ? 'auto' : 'none', zIndex: 10}}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          cursor: dragRef.current
            ? 'grabbing'
            : activeTool !== 'cursor'
              ? 'crosshair'
              : undefined
        }}
        onMouseDown={interactive ? onMouseDown : undefined}
      />
      {hovered && hoverPos && (
        <div
          className="absolute z-50 bg-[#1c1c1f] border border-gray-700 rounded-lg shadow-xl px-3 py-2 text-xs whitespace-nowrap pointer-events-none"
          style={{
            left: hoverPos.x,
            top: hoverPos.y,
            transform: 'translateX(-50%)'
          }}
        >
          {hovered.type === 'horizontal' && (
            <span className="text-blue-400">
              水平线{' '}
              <span className="text-gray-300">{hovered.price1.toFixed(4)}</span>
            </span>
          )}
          {hovered.type === 'vertical' && (
            <span className="text-yellow-400">
              垂直线{' '}
              <span className="text-gray-300">
                {new Date(hovered.time1 * 1000).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai'
                })}
              </span>
            </span>
          )}
          {hovered.type === 'trendline' && hovered.time2 != null && (
            <div className="space-y-0.5">
              <div className="text-yellow-400">趋势线</div>
              <div className="text-gray-400">
                起点:{' '}
                <span className="text-gray-300">
                  {hovered.price1.toFixed(4)}
                </span>
              </div>
              <div className="text-gray-400">
                终点:{' '}
                <span className="text-gray-300">
                  {(hovered.price2 ?? hovered.price1).toFixed(4)}
                </span>
              </div>
              <div className="text-gray-400">
                幅度:{' '}
                <span className="text-gray-300">
                  {(
                    (((hovered.price2 ?? hovered.price1) - hovered.price1) /
                      hovered.price1) *
                    100
                  ).toFixed(2)}
                  %
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
