'use client'

import {useState, useCallback, useEffect, useRef} from 'react'
import {
  X,
  ChevronLeft,
  Tag,
  BookOpen,
  Plus,
  Trash2,
  Edit3,
  Save,
  ChevronDown,
  ChevronUp,
  FileText,
  RotateCcw,
  ArrowRightToLine,
  Minus,
  Eraser,
  Maximize2
} from 'lucide-react'
import type {IChartApi, ISeriesApi, Time} from 'lightweight-charts'
import type {SymbolReview} from '@nexttrade/shared'
import dynamic from 'next/dynamic'

const KlineChart = dynamic(() => import('@/components/chart/KlineChart'), {
  ssr: false
})
const DrawingOverlay = dynamic(
  () => import('@/components/chart/DrawingOverlay'),
  {ssr: false}
)
const LeftToolbar = dynamic(() => import('@/components/chart/LeftToolbar'), {
  ssr: false
})
import type {TrendLine} from '@/components/chart/DrawingOverlay'
import type {DailyAnalysisItem} from '@nexttrade/shared'
import type {CrosshairInfo} from '@/components/chart/KlineChart'
import {API_ORIGIN, authHeaders, checkResponse, getToken} from '@/lib/api'
import {generateId} from '@/lib/utils'
import {useDeviceType} from '@/hooks/useDeviceType'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d', '3d'] as const
const PRESET_TAGS = [
  {tag: '突破', color: '#22c55e'},
  {tag: '回调', color: '#f59e0b'},
  {tag: '支撑', color: '#3b82f6'},
  {tag: '压力', color: '#ef4444'},
  {tag: '看涨', color: '#10b981'},
  {tag: '看跌', color: '#f43f5e'},
  {tag: '放量', color: '#a855f7'},
  {tag: '十字星', color: '#94a3b8'},
  {tag: '反转', color: '#ec4899'},
  {tag: '关注', color: '#eab308'}
]

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  })
}

function fmtVol(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(0)
}

interface SymbolDetailProps {
  item: DailyAnalysisItem
  selectedDate: string
  onClose: () => void
  /** PC/平板端放大/缩小切换 */
  expanded?: boolean
  onExpandToggle?: () => void
  /** 实时 ticker 数据（WebSocket） */
  ticker?: {
    price: string
    change: string
    quoteVol: string
  }
}

export default function SymbolDetail({
  item,
  selectedDate,
  onClose,
  expanded,
  onExpandToggle,
  ticker
}: SymbolDetailProps) {
  const [timeframe, setTimeframe] = useState<string>('1h')
  const [activeTool, setActiveTool] = useState<
    'cursor' | 'horizontal' | 'trendline' | 'vertical' | 'ruler'
  >('cursor')
  const [drawings, setDrawings] = useState<TrendLine[] | null>(null)
  const DRAWINGS_KEY = `drawings:${item.symbol}`
  const [chart, setChart] = useState<IChartApi | null>(null)
  const [candleSeries, setCandleSeries] =
    useState<ISeriesApi<'Candlestick'> | null>(null)

  // 想法
  const [reviews, setReviews] = useState<SymbolReview[]>([])
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewContent, setReviewContent] = useState('')
  const [reviewTags, setReviewTags] = useState<
    Array<{tag: string; color: string}>
  >([])
  const [customTag, setCustomTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedReviewId, setExpandedReviewId] = useState<number | null>(null)
  const [journalTab, setJournalTab] = useState<'new' | 'history'>('new')
  const journalRef = useRef<HTMLDivElement>(null)
  const journalTouchStart = useRef<{x: number; y: number} | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    price: number
    hitId?: string
  } | null>(null)
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const [editMode, setEditMode] = useState(false)
  const [deleteMode, setDeleteMode] = useState(false)
  const {isMobile} = useDeviceType()
  // 固定初始值 300 避免 hydration 不匹配，ResizeObserver 会在 mount 后矫正
  const [chartHeight, setChartHeight] = useState(300)
  const prevHeightRef = useRef(chartHeight)
  const [crosshairInfo, setCrosshairInfo] = useState<CrosshairInfo | null>(null)
  const justSyncedRef = useRef(false)
  const loadedRef = useRef(false)
  const drawFetchedRef = useRef<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(() => !!getToken())

  // 辅助线保存模式: 'local' | 'cloud'
  const SAVE_MODE_KEY = 'draw_save_mode'
  const [drawSaveMode, setDrawSaveMode] = useState<'local' | 'cloud'>('local')

  // hydration 完成后从 localStorage 恢复
  useEffect(() => {
    const saved = localStorage.getItem(SAVE_MODE_KEY) as
      | 'local'
      | 'cloud'
      | null
    if (saved) setDrawSaveMode(saved)
  }, [])

  // 切换保存模式
  const toggleSaveMode = useCallback(() => {
    setDrawSaveMode(prev => {
      if (prev === 'cloud') {
        localStorage.setItem(SAVE_MODE_KEY, 'local')
        return 'local'
      }
      // 切到云端
      if (!getToken()) return prev // 未登录不可切
      const local = localStorage.getItem(DRAWINGS_KEY)
      if (local) {
        try {
          const data = JSON.parse(local)
          fetch(
            `${API_ORIGIN}/api/symbols/${encodeURIComponent(item.symbol)}/drawings`,
            {
              method: 'PUT',
              headers: {'Content-Type': 'application/json', ...authHeaders()},
              body: JSON.stringify({data})
            }
          )
        } catch {}
      }
      localStorage.setItem(SAVE_MODE_KEY, 'cloud')
      return 'cloud'
    })
  }, [DRAWINGS_KEY, item.symbol])

  // 监听登录状态变化 → 自动同步本地数据到云端
  useEffect(() => {
    const fn = () => {
      const hasToken = !!getToken()
      if (hasToken && !loggedIn) {
        const local = localStorage.getItem(DRAWINGS_KEY)
        if (local) {
          try {
            const data = JSON.parse(local)
            fetch(
              `${API_ORIGIN}/api/symbols/${encodeURIComponent(item.symbol)}/drawings`,
              {
                method: 'PUT',
                headers: {'Content-Type': 'application/json', ...authHeaders()},
                body: JSON.stringify({data})
              }
            )
            localStorage.setItem(SAVE_MODE_KEY, 'cloud')
            setDrawSaveMode('cloud')
          } catch {}
        }
      }
      setLoggedIn(hasToken)
    }
    window.addEventListener('storage', fn)
    window.addEventListener('auth:login', fn)
    window.addEventListener('auth:logout', fn)
    return () => {
      window.removeEventListener('storage', fn)
      window.removeEventListener('auth:login', fn)
      window.removeEventListener('auth:logout', fn)
    }
  }, [loggedIn, DRAWINGS_KEY, item.symbol])

  // 加载辅助线
  useEffect(() => {
    if (drawFetchedRef.current === item.symbol) return
    drawFetchedRef.current = item.symbol
    loadedRef.current = false

    // 1. 总是先从 localStorage 加载（本地缓存）
    const cached = localStorage.getItem(DRAWINGS_KEY)
    if (cached) {
      try {
        setDrawings(JSON.parse(cached))
      } catch {}
    }

    // 2. 如果登录了，再从云端拉取最新数据覆盖
    if (getToken()) {
      const ctrl = new AbortController()
      fetch(
        `${API_ORIGIN}/api/symbols/${encodeURIComponent(item.symbol)}/drawings`,
        {headers: authHeaders(), signal: ctrl.signal}
      )
        .then(checkResponse)
        .then(r => r.json())
        .then(d => {
          if (!ctrl.signal.aborted && d.success && Array.isArray(d.data)) {
            setDrawings(d.data)
            // 同时更新本地缓存
            localStorage.setItem(DRAWINGS_KEY, JSON.stringify(d.data))
          }
        })
        .catch(() => {})
        .finally(() => {
          loadedRef.current = true
        })
      return () => {
        ctrl.abort()
        drawFetchedRef.current = null
      }
    }

    loadedRef.current = true
  }, [DRAWINGS_KEY, item.symbol])

  // 保存辅助线：同时写入 localStorage + 云端
  const saveKeyRef = useRef(DRAWINGS_KEY)
  saveKeyRef.current = DRAWINGS_KEY
  useEffect(() => {
    if (drawings === null) return
    const key = saveKeyRef.current
    // 始终保存到 localStorage
    localStorage.setItem(key, JSON.stringify(drawings))
    // 登录时同步到云端
    if (getToken()) {
      fetch(
        `${API_ORIGIN}/api/symbols/${encodeURIComponent(item.symbol)}/drawings`,
        {
          method: 'PUT',
          headers: {'Content-Type': 'application/json', ...authHeaders()},
          body: JSON.stringify({data: drawings})
        }
      ).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings])

  useEffect(() => {
    if (!item.symbol) return
    // 切换币种时先清空旧数据，避免闪现旧想法
    setReviews([])
    const ctrl = new AbortController()
    fetch(
      `${API_ORIGIN}/api/symbols/${encodeURIComponent(item.symbol)}/reviews`,
      {
        headers: authHeaders(),
        signal: ctrl.signal
      }
    )
      .then(checkResponse)
      .then(r => r.json())
      .then(d => {
        if (!ctrl.signal.aborted && d.success) setReviews(d.data)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [item.symbol])

  useEffect(() => {
    const el = chartAreaRef.current
    if (!el) return
    const measure = () => {
      const h = el.clientHeight
      if (h > 50 && h !== prevHeightRef.current) {
        prevHeightRef.current = h
        setChartHeight(h)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleChartReady = useCallback(
    (c: IChartApi, cs: ISeriesApi<'Candlestick'>) => {
      setChart(c)
      setCandleSeries(cs)
    },
    []
  )

  const handleCrosshairChange = useCallback(
    (info: CrosshairInfo | null) => setCrosshairInfo(info),
    []
  )

  const handleAddDrawing = useCallback((line: Omit<TrendLine, 'id'>) => {
    setDrawings(prev => [...(prev ?? []), {...line, id: generateId()}])
    if (line.type !== 'trendline') setActiveTool('cursor')
  }, [])
  const handleDeleteDrawing = useCallback(
    (id: string) => setDrawings(prev => (prev ?? []).filter(d => d.id !== id)),
    []
  )
  const handleUpdateDrawing = useCallback(
    (id: string, updates: Partial<Omit<TrendLine, 'id'>>) =>
      setDrawings(prev =>
        (prev ?? []).map(d => (d.id === id ? {...d, ...updates} : d))
      ),
    []
  )
  const handleClearAll = useCallback(() => setDrawings([]), [])

  const handleChartContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (!candleSeries || !chart) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const price = candleSeries.coordinateToPrice(y)
      if (price === null) return
      let hitId: string | undefined
      const ts = chart.timeScale()
      for (const d of drawings ?? []) {
        if (d.type === 'horizontal') {
          const py = candleSeries.priceToCoordinate(d.price1)
          if (py !== null && Math.abs(y - py) < 10) {
            hitId = d.id
            break
          }
        } else if (d.type === 'vertical') {
          const px = ts.timeToCoordinate(d.time1 as never)
          if (px !== null && Math.abs(x - px) < 10) {
            hitId = d.id
            break
          }
        } else if (d.type === 'trendline' && d.time2 != null) {
          const px1 = ts.timeToCoordinate(d.time1 as never)
          const py1 = candleSeries.priceToCoordinate(d.price1)
          const px2 = ts.timeToCoordinate(d.time2 as never)
          const py2 = candleSeries.priceToCoordinate(d.price2 ?? d.price1)
          if (px1 !== null && py1 !== null && px2 !== null && py2 !== null) {
            const dist =
              Math.abs(
                (py2 - py1) * x - (px2 - px1) * y + px2 * py1 - py2 * px1
              ) / Math.sqrt((py2 - py1) ** 2 + (px2 - px1) ** 2)
            if (dist < 12) {
              hitId = d.id
              break
            }
          }
        }
      }
      setCtxMenu({x: e.clientX, y: e.clientY, price, hitId})
    },
    [candleSeries, chart, drawings]
  )

  useEffect(() => {
    if (!ctxMenu) return
    const fn = () => setCtxMenu(null)
    document.addEventListener('click', fn)
    return () => document.removeEventListener('click', fn)
  }, [ctxMenu])

  // 想法
  const addTag = (tag: string, color: string) => {
    if (!reviewTags.some(t => t.tag === tag))
      setReviewTags(prev => [...prev, {tag, color}])
  }
  const removeTag = (tag: string) =>
    setReviewTags(prev => prev.filter(t => t.tag !== tag))
  const [presetOrder, setPresetOrder] = useState<string[]>(() =>
    PRESET_TAGS.map(p => p.tag)
  )
  const [dragPresetIdx, setDragPresetIdx] = useState<number | null>(null)
  const handleAddCustom = () => {
    const t = customTag.trim()
    if (t && !reviewTags.some(x => x.tag === t)) {
      addTag(t, '#6b7280')
      setCustomTag('')
    }
  }

  const handleSaveReview = useCallback(async () => {
    if (!reviewContent.trim()) return
    setSaving(true)
    try {
      const res = await fetch(
        `${API_ORIGIN}/api/symbols/${encodeURIComponent(item.symbol)}/reviews`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json', ...authHeaders()},
          body: JSON.stringify({
            title: reviewTitle.trim(),
            content: reviewContent.trim(),
            tags: reviewTags
          })
        }
      )
      checkResponse(res)
      const data = await res.json()
      if (data.success) {
        setReviews(prev => [data.data, ...prev])
        setReviewTitle('')
        setReviewContent('')
        setReviewTags([])
      }
    } finally {
      setSaving(false)
    }
  }, [item.symbol, reviewTitle, reviewContent, reviewTags])

  const handleDeleteReview = useCallback(
    async (id: number) => {
      setReviews(prev => prev.filter(r => r.id !== id))
      try {
        const res = await fetch(
          `${API_ORIGIN}/api/symbols/${encodeURIComponent(item.symbol)}/reviews/${id}`,
          {method: 'DELETE', headers: authHeaders()}
        )
        checkResponse(res)
      } catch {}
    },
    [item.symbol]
  )
  const handleEditReview = (r: SymbolReview) => {
    setReviewTitle(r.title || '')
    setReviewContent(r.content || '')
    setReviewTags(r.tags || [])
  }

  const containerRef2 = useRef<HTMLDivElement>(null)

  // 展开/缩小时重新调整图表尺寸并自适应
  useEffect(() => {
    if (!chart) return
    const timer = setTimeout(() => {
      const parent = chart.chartElement()?.parentElement
      if (parent) {
        chart.applyOptions({width: parent.clientWidth})
      }
      if (candleSeries) {
        const data = candleSeries.data()
        if (data.length > 0) {
          // 默认显示 120 根 K 线，上下边距对齐
          const visibleCount = 120
          const last = data[data.length - 1].time as number
          const first = data[Math.max(0, data.length - visibleCount)]
            .time as number
          chart
            .timeScale()
            .setVisibleRange({from: first as any, to: last as any})
          chart.priceScale('right').applyOptions({
            scaleMargins: {top: 0.08, bottom: 0.08}
          })
        }
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [expanded, chart, candleSeries])

  return (
    <div
      ref={containerRef2}
      className="rounded-xl bg-[#18181b] border border-gray-700/50 h-full flex flex-col overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 md:p-4 pb-2 border-b border-gray-700/30 shrink-0 gap-2">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {/* 移动端返回按钮 */}
          <button
            onClick={onClose}
            className="md:hidden text-gray-400 hover:text-gray-200 p-1 -ml-1"
            aria-label="返回"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h3 className="text-base md:text-lg font-bold text-gray-100 shrink-0">
            {item.base}{' '}
            <span className="text-xs md:text-sm text-gray-500 font-normal">
              /USDT
            </span>
          </h3>
          {/* 今日实时行情 */}
          <div className="hidden sm:flex items-center gap-2 text-xs">
            {ticker ? (
              <>
                <span className="text-gray-200 font-mono tabular-nums">
                  ${parseFloat(ticker.price).toFixed(4)}
                </span>
                <span
                  className={`font-medium ${Number(ticker.change) >= 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {Number(ticker.change) >= 0 ? '+' : ''}
                  {Number(ticker.change).toFixed(2)}%
                </span>
                <span className="text-gray-500">
                  量{' '}
                  <span className="text-gray-300">
                    {fmtVol(Number(ticker.quoteVol))}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span
                  className={`font-medium shrink-0 ${item.change >= 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {item.change >= 0 ? '+' : ''}
                  {item.change.toFixed(2)}%
                </span>
                {item.quoteVolume > 0 && (
                  <span className="text-gray-500">
                    量{' '}
                    <span className="text-gray-300">
                      {fmtVol(item.quoteVolume)}
                    </span>
                  </span>
                )}
              </>
            )}
          </div>
          {/* 昨日 OHLC（隐藏） */}
          <div className="hidden xs:flex items-center gap-2 text-[10px] text-gray-600">
            <span>
              O:
              <span className="text-gray-400 ml-0.5">
                {item.open.toFixed(4)}
              </span>
            </span>
            <span>
              H:
              <span className="text-gray-400 ml-0.5">
                {item.high.toFixed(4)}
              </span>
            </span>
            <span>
              L:
              <span className="text-gray-400 ml-0.5">
                {item.low.toFixed(4)}
              </span>
            </span>
            <span>
              C:
              <span className="text-gray-400 ml-0.5">
                {item.close.toFixed(4)}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          {/* 保存模式 */}
          <button
            onClick={toggleSaveMode}
            disabled={drawSaveMode === 'local' && !getToken()}
            title={
              !getToken() && drawSaveMode === 'local'
                ? '登录后可开启云端保存'
                : drawSaveMode === 'cloud'
                  ? '云端保存'
                  : '本地保存'
            }
            className={`text-[10px] px-2 py-1 rounded-md transition-colors font-medium ${
              drawSaveMode === 'cloud'
                ? 'bg-primary/20 text-primary cursor-pointer hover:bg-primary/30'
                : !getToken()
                  ? 'text-gray-600 cursor-not-allowed'
                  : 'text-gray-400 hover:text-gray-300 cursor-pointer'
            }`}
          >
            {drawSaveMode === 'cloud' ? '云' : '本地'}
          </button>
          {/* PC/平板放大按钮 — 移动端隐藏 */}
          {/* 放大/全屏按钮 */}
          <button
            onClick={() => {
              if (onExpandToggle) {
                // PC/平板：展开右侧面板
                onExpandToggle()
              } else {
                // 移动端：全屏
                const el = containerRef2.current
                if (el && !document.fullscreenElement) {
                  el.requestFullscreen?.()
                } else {
                  document.exitFullscreen?.()
                }
              }
            }}
            className="flex text-gray-500 hover:text-gray-300 p-1 -mr-1"
            title={
              document.fullscreenElement
                ? '退出全屏'
                : expanded
                  ? '缩小'
                  : '放大'
            }
          >
            <Maximize2
              className={`w-4 h-4 transition-transform ${expanded || document.fullscreenElement ? 'rotate-45' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* 图表区 */}
      <div className="flex-[2] min-h-0 p-3 md:p-4 pb-2 flex flex-col">
        <div className="flex items-center gap-1 mb-2 shrink-0 flex-wrap">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`text-xs px-2 py-1 md:py-0.5 rounded transition-colors ${timeframe === tf ? 'bg-primary/20 text-primary' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {tf}
            </button>
          ))}
          {crosshairInfo && crosshairInfo.high > 0 && (
            <span className="ml-auto flex items-center gap-2 text-[10px] text-gray-500">
              <span>
                振:
                <span className="text-gray-300">
                  {(
                    ((crosshairInfo.high - crosshairInfo.low) /
                      crosshairInfo.low) *
                    100
                  ).toFixed(2)}
                  %
                </span>
              </span>
              <span>
                涨:
                <span
                  className={`${(crosshairInfo.close - crosshairInfo.open) / crosshairInfo.open >= 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {((crosshairInfo.close - crosshairInfo.open) /
                    crosshairInfo.open) *
                    100 >=
                  0
                    ? '+'
                    : ''}
                  {(
                    ((crosshairInfo.close - crosshairInfo.open) /
                      crosshairInfo.open) *
                    100
                  ).toFixed(2)}
                  %
                </span>
              </span>
            </span>
          )}
        </div>
        <div className="flex gap-3 flex-1 min-h-0">
          <LeftToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onClearAll={handleClearAll}
            hasDrawings={Array.isArray(drawings) && drawings.length > 0}
            editMode={editMode}
            onEditModeChange={setEditMode}
            deleteMode={deleteMode}
            onDeleteModeChange={setDeleteMode}
          />
          <div
            ref={chartAreaRef}
            className="relative flex-1 min-h-0 overflow-hidden"
            onContextMenu={e => {
              if (isMobile) return
              handleChartContextMenu(e)
            }}
          >
            <KlineChart
              key={item.symbol}
              symbol={item.symbol}
              timeframe={timeframe}
              height={chartHeight}
              onChartReady={handleChartReady}
              onCrosshairChange={handleCrosshairChange}
            />
            <DrawingOverlay
              key={`ov-${item.symbol}`}
              chart={chart}
              candleSeries={candleSeries}
              activeTool={activeTool}
              drawings={drawings ?? []}
              onAddDrawing={handleAddDrawing}
              onDeleteDrawing={handleDeleteDrawing}
              onUpdateDrawing={handleUpdateDrawing}
              onClearAll={handleClearAll}
              onToolChange={setActiveTool}
              editMode={editMode}
              deleteMode={deleteMode}
            />
          </div>
        </div>
        {ctxMenu && (
          <div
            className="fixed z-50 bg-[#1c1c1f] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[150px]"
            style={{left: ctxMenu.x, top: ctxMenu.y}}
          >
            {ctxMenu.hitId ? (
              <button
                onClick={() => {
                  handleDeleteDrawing(ctxMenu.hitId!)
                  setCtxMenu(null)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> 删除该线
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    chart?.timeScale().resetTimeScale()
                    setCtxMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> 重置视图
                </button>
                <button
                  onClick={() => {
                    chart?.timeScale().scrollToRealTime()
                    setCtxMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <ArrowRightToLine className="w-3 h-3" /> 回到当前
                </button>
                <div className="border-t border-gray-700/50 my-1" />
                <button
                  onClick={() => {
                    handleAddDrawing({
                      type: 'horizontal',
                      time1: 0,
                      price1: ctxMenu.price
                    })
                    setCtxMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <Minus className="w-3 h-3" /> 添加水平线
                </button>
                <button
                  onClick={() => {
                    handleClearAll()
                    setCtxMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <Eraser className="w-3 h-3" /> 清除所有
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 想法区 - 手机 Tab 切换，桌面左右布局 */}
      <div
        className="border-t border-gray-700/30 p-3 flex-1 min-h-0 flex flex-col relative"
        ref={journalRef}
        onTouchStart={e => {
          journalTouchStart.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
          }
        }}
        onTouchEnd={e => {
          if (!journalTouchStart.current) return
          const dx = e.changedTouches[0].clientX - journalTouchStart.current.x
          const dy = e.changedTouches[0].clientY - journalTouchStart.current.y
          journalTouchStart.current = null
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            setJournalTab(prev => (dx < 0 ? 'history' : 'new'))
          }
        }}
      >
        {/* 未登录遮罩 */}
        {!getToken() && (
          <div className="absolute inset-0 z-20 bg-[#18181b]/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 rounded-b-xl">
            <FileText className="w-8 h-8 text-gray-600" />
            <p className="text-sm text-gray-500">登录后可记录想法</p>
            <a
              href="/settings"
              className="px-4 py-1.5 bg-primary/20 text-primary rounded-lg text-xs hover:bg-primary/30 transition-colors"
            >
              去登录
            </a>
          </div>
        )}
        <div className="flex items-center justify-between shrink-0">
          <h4 className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> 想法
          </h4>
          {/* 手机端 Tab 切换按钮 */}
          <div className="flex gap-1 md:hidden">
            <button
              onClick={() => setJournalTab('new')}
              className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${
                journalTab === 'new'
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              新增
            </button>
            <button
              onClick={() => setJournalTab('history')}
              className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${
                journalTab === 'history'
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              历史
            </button>
          </div>
        </div>
        <div className="flex gap-3 flex-1 min-h-0 mt-2">
          {/* 左：新建想法 */}
          <div
            className={`md:w-1/2 flex flex-col gap-1.5 flex-1 min-h-0 ${journalTab === 'history' ? 'hidden md:flex' : 'w-full'}`}
          >
            <input
              value={reviewTitle}
              onChange={e => setReviewTitle(e.target.value)}
              placeholder="标题（可选）"
              className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200
                         placeholder:text-gray-600 focus:outline-none focus:border-blue-500 transition-colors shrink-0"
            />
            {/* 文本框 + 保存按钮 + 标签（一列排列，避免被裁剪） */}
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <div className="flex gap-1.5 flex-1 min-h-0 overflow-hidden">
                <textarea
                  value={reviewContent}
                  onChange={e => setReviewContent(e.target.value)}
                  placeholder="记录你的交易思路..."
                  rows={2}
                  className="flex-1 bg-[#0a0a0b] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200
                             placeholder:text-gray-600 focus:outline-none focus:border-blue-500 transition-colors resize-none min-h-[36px] overflow-y-auto"
                />
                {/* 标签选择器 */}
                <div className="w-28 shrink-0 flex flex-col gap-1 min-h-0">
                  <span className="text-[10px] text-gray-500 font-medium shrink-0">
                    标签
                  </span>
                  <div className="flex flex-col gap-0.5 overflow-y-auto flex-1 min-h-0">
                    {reviewTags.map(t => (
                      <span
                        key={t.tag}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          color: t.color,
                          backgroundColor: t.color + '15'
                        }}
                      >
                        <span className="truncate flex-1">{t.tag}</span>
                        <button
                          onClick={() => removeTag(t.tag)}
                          className="hover:opacity-70 shrink-0"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                    {presetOrder
                      .map(tag => PRESET_TAGS.find(p => p.tag === tag)!)
                      .filter(p => !reviewTags.some(t => t.tag === p.tag))
                      .map((p, idx) => (
                        <span
                          key={p.tag}
                          draggable
                          onDragStart={() => setDragPresetIdx(idx)}
                          onDragOver={e => {
                            e.preventDefault()
                            if (
                              dragPresetIdx !== null &&
                              dragPresetIdx !== idx
                            ) {
                              setPresetOrder(prev => {
                                const arr = [...prev]
                                const [item] = arr.splice(dragPresetIdx, 1)
                                arr.splice(idx, 0, item)
                                return arr
                              })
                              setDragPresetIdx(idx)
                            }
                          }}
                          onDragEnd={() => setDragPresetIdx(null)}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-grab active:cursor-grabbing shrink-0 ${
                            dragPresetIdx === idx
                              ? 'opacity-40'
                              : 'opacity-60 hover:opacity-100'
                          }`}
                          style={{
                            borderColor: p.color + '40',
                            color: p.color,
                            backgroundColor: p.color + '10'
                          }}
                          onClick={() => addTag(p.tag, p.color)}
                        >
                          <span className="truncate flex-1">{p.tag}</span>
                        </span>
                      ))}
                    <input
                      value={customTag}
                      onChange={e => setCustomTag(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                      placeholder="自定义..."
                      className="w-full bg-[#0a0a0b] border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-400
                               placeholder:text-gray-700 focus:outline-none focus:border-blue-500 mt-1 shrink-0"
                    />
                  </div>
                </div>
              </div>
            </div>
            {/* 保存按钮 - 固定在底部 */}
            <div className="flex items-center gap-2 shrink-0 pt-0.5">
              <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                {reviewTags.map(t => (
                  <span
                    key={t.tag}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                    style={{color: t.color, backgroundColor: t.color + '15'}}
                  >
                    {t.tag}
                    <button
                      onClick={() => removeTag(t.tag)}
                      className="hover:opacity-70"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <button
                onClick={handleSaveReview}
                disabled={saving || !reviewContent.trim()}
                className="ml-auto px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-xs hover:bg-primary/30 disabled:opacity-40 transition-colors flex items-center gap-1 shrink-0"
              >
                <Save className="w-3.5 h-3.5" /> {saving ? '...' : '保存'}
              </button>
            </div>
          </div>

          {/* 右：历史想法 */}
          <div
            className={`md:w-1/2 md:border-l md:border-gray-700/30 md:pl-3 overflow-y-auto space-y-1 ${journalTab === 'new' ? 'hidden md:block' : 'w-full'}`}
          >
            {reviews.length === 0 ? (
              <p className="text-xs text-gray-600 py-2">暂无想法记录</p>
            ) : (
              reviews.map(r => (
                <div
                  key={r.id}
                  className={`rounded border border-gray-700/50 overflow-hidden transition-colors ${
                    expandedReviewId === r.id
                      ? 'bg-gray-800/70'
                      : 'bg-gray-800/20 hover:bg-gray-800/40'
                  }`}
                >
                  <div
                    onClick={() =>
                      setExpandedReviewId(
                        expandedReviewId === r.id ? null : r.id
                      )
                    }
                    className="flex items-center gap-1.5 px-2 py-1 cursor-pointer"
                  >
                    <FileText className="w-3 h-3 text-gray-500 shrink-0" />
                    <span className="text-[11px] text-gray-300 truncate flex-1">
                      {r.title || r.content.slice(0, 30)}
                    </span>
                    <span className="text-[9px] text-gray-600 shrink-0">
                      {new Date(r.createdAt).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric'
                      })}{' '}
                      {new Date(r.createdAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    {r.tags && r.tags.length > 0 && (
                      <span className="flex gap-0.5 shrink-0">
                        {r.tags.slice(0, 2).map(t => (
                          <span
                            key={t.tag}
                            className="text-[8px] px-1 py-0.5 rounded"
                            style={{
                              color: t.color,
                              backgroundColor: t.color + '15'
                            }}
                          >
                            {t.tag}
                          </span>
                        ))}
                        {r.tags.length > 2 && (
                          <span className="text-[8px] text-gray-600">
                            +{r.tags.length - 2}
                          </span>
                        )}
                      </span>
                    )}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        handleEditReview(r)
                      }}
                      className="text-gray-500 hover:text-gray-300 shrink-0"
                    >
                      <Edit3 className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        handleDeleteReview(r.id)
                      }}
                      className="text-gray-500 hover:text-red-400 shrink-0"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  {expandedReviewId === r.id && (
                    <div className="px-2 pb-2 pt-0 space-y-1">
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-0.5">
                          {r.tags.map(t => (
                            <span
                              key={t.tag}
                              className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-[9px]"
                              style={{
                                color: t.color,
                                backgroundColor: t.color + '15'
                              }}
                            >
                              <Tag className="w-2 h-2" /> {t.tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.content && (
                        <p className="text-[11px] text-gray-400 whitespace-pre-wrap">
                          {r.content}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
