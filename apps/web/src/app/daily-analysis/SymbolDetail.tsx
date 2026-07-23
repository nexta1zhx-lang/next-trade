'use client'

import {useState, useCallback, useEffect, useRef} from 'react'
import {
  X,
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
  Eraser
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
import {authHeaders, checkResponse, getToken} from '@/lib/api'

const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const
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

interface SymbolDetailProps {
  item: DailyAnalysisItem
  selectedDate: string
  onClose: () => void
}

export default function SymbolDetail({
  item,
  selectedDate,
  onClose
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
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    price: number
    hitId?: string
  } | null>(null)
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const [chartHeight, setChartHeight] = useState(400)
  const prevHeightRef = useRef(400)
  const [crosshairInfo, setCrosshairInfo] = useState<CrosshairInfo | null>(null)
  const justSyncedRef = useRef(false)
  const loadedRef = useRef(false)
  const reviewFetchedRef = useRef<string | null>(null)
  const drawFetchedRef = useRef<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(() => !!getToken())

  // 辅助线保存模式: 'local' | 'cloud'
  const SAVE_MODE_KEY = 'draw_save_mode'
  const [drawSaveMode, setDrawSaveMode] = useState<'local' | 'cloud'>(() =>
    typeof window !== 'undefined'
      ? (localStorage.getItem(SAVE_MODE_KEY) as 'local' | 'cloud') || 'local'
      : 'local'
  )

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
          justSyncedRef.current = true
          fetch(`/api/symbols/${encodeURIComponent(item.symbol)}/drawings`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json', ...authHeaders()},
            body: JSON.stringify({data})
          })
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
            fetch(`/api/symbols/${encodeURIComponent(item.symbol)}/drawings`, {
              method: 'PUT',
              headers: {'Content-Type': 'application/json', ...authHeaders()},
              body: JSON.stringify({data})
            })
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
    if (drawSaveMode === 'cloud' && getToken()) {
      if (justSyncedRef.current) {
        justSyncedRef.current = false
        loadedRef.current = true
        return
      }
      const ctrl = new AbortController()
      fetch(`/api/symbols/${encodeURIComponent(item.symbol)}/drawings`, {
        headers: authHeaders(),
        signal: ctrl.signal
      })
        .then(checkResponse)
        .then(r => r.json())
        .then(d => {
          if (!ctrl.signal.aborted) {
            if (d.success && Array.isArray(d.data)) setDrawings(d.data)
            else setDrawings([])
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
    } else {
      const saved = localStorage.getItem(DRAWINGS_KEY)
      if (saved) {
        try {
          setDrawings(JSON.parse(saved))
        } catch {}
      } else {
        setDrawings([])
      }
      loadedRef.current = true
    }
  }, [DRAWINGS_KEY, drawSaveMode, item.symbol])

  // 保存辅助线（仅当 drawings 数据实际变化时触发）
  const saveKeyRef = useRef(DRAWINGS_KEY)
  saveKeyRef.current = DRAWINGS_KEY
  useEffect(() => {
    if (drawings === null || drawings.length === 0) return
    const key = saveKeyRef.current
    if (drawSaveMode === 'cloud' && getToken()) {
      fetch(`/api/symbols/${encodeURIComponent(item.symbol)}/drawings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json', ...authHeaders()},
        body: JSON.stringify({data: drawings})
      }).catch(() => {})
    } else {
      localStorage.setItem(key, JSON.stringify(drawings))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings])

  useEffect(() => {
    if (!item.symbol || reviewFetchedRef.current === item.symbol) return
    reviewFetchedRef.current = item.symbol
    const ctrl = new AbortController()
    fetch(`/api/symbols/${encodeURIComponent(item.symbol)}/reviews`, {
      headers: authHeaders(),
      signal: ctrl.signal
    })
      .then(checkResponse)
      .then(r => r.json())
      .then(d => {
        if (!ctrl.signal.aborted && d.success) setReviews(d.data)
      })
      .catch(() => {})
    return () => {
      ctrl.abort()
      reviewFetchedRef.current = null
    }
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
    setDrawings(prev => [...(prev ?? []), {...line, id: crypto.randomUUID()}])
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
        `/api/symbols/${encodeURIComponent(item.symbol)}/reviews`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json', ...authHeaders()},
          body: JSON.stringify({
            date: selectedDate,
            title: reviewTitle.trim(),
            content: reviewContent.trim(),
            tags: reviewTags
          })
        }
      )
      checkResponse(res)
      const data = await res.json()
      if (data.success) {
        setReviews(prev => {
          const idx = prev.findIndex(r => r.date === data.data.date)
          if (idx >= 0) {
            const n = [...prev]
            n[idx] = data.data
            return n
          }
          return [data.data, ...prev]
        })
        setReviewTitle('')
        setReviewContent('')
        setReviewTags([])
      }
    } finally {
      setSaving(false)
    }
  }, [item.symbol, selectedDate, reviewTitle, reviewContent, reviewTags])

  const handleDeleteReview = useCallback(
    async (id: number) => {
      setReviews(prev => prev.filter(r => r.id !== id))
      try {
        const res = await fetch(
          `/api/symbols/${encodeURIComponent(item.symbol)}/reviews/${id}`,
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

  return (
    <div className="rounded-xl bg-[#18181b] border border-gray-700/50 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2 border-b border-gray-700/30 shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-gray-100">
            {item.base}{' '}
            <span className="text-sm text-gray-500 font-normal">/USDT</span>
          </h3>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>
              O:
              <span className="text-gray-300 ml-1">{item.open.toFixed(4)}</span>
            </span>
            <span>
              H:
              <span className="text-gray-300 ml-1">{item.high.toFixed(4)}</span>
            </span>
            <span>
              L:
              <span className="text-gray-300 ml-1">{item.low.toFixed(4)}</span>
            </span>
            <span>
              C:
              <span className="text-gray-300 ml-1">
                {item.close.toFixed(4)}
              </span>
            </span>
          </div>
          <span
            className={`text-xs font-medium ${item.change >= 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {item.change >= 0 ? '+' : ''}
            {item.change.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 图表区 */}
      <div className="flex-[2] min-h-0 p-4 pb-2 flex flex-col">
        <div className="flex items-center gap-1 mb-2 shrink-0">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${timeframe === tf ? 'bg-primary/20 text-primary' : 'text-gray-500 hover:text-gray-300'}`}
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
              <span className="text-gray-600">|</span>
              <span>O:{crosshairInfo.open.toFixed(4)}</span>
              <span>H:{crosshairInfo.high.toFixed(4)}</span>
              <span>L:{crosshairInfo.low.toFixed(4)}</span>
              <span>C:{crosshairInfo.close.toFixed(4)}</span>
            </span>
          )}
        </div>
        <div className="flex gap-3 flex-1 min-h-0">
          <LeftToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onClearAll={handleClearAll}
            hasDrawings={Array.isArray(drawings) && drawings.length > 0}
          />
          <div
            ref={chartAreaRef}
            className="relative flex-1 min-h-0"
            onContextMenu={handleChartContextMenu}
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

      {/* 想法区 - 左右布局：新建想法 | 历史想法 */}
      <div className="border-t border-gray-700/30 p-3 flex-1 min-h-0 flex flex-col relative">
        {/* 未登录遮罩 */}
        {!getToken() && (
          <div className="absolute inset-0 z-20 bg-[#18181b]/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 rounded-b-xl">
            <FileText className="w-8 h-8 text-gray-600" />
            <p className="text-sm text-gray-500">登录后可记录想法</p>
            <a
              href="/orders"
              className="px-4 py-1.5 bg-primary/20 text-primary rounded-lg text-xs hover:bg-primary/30 transition-colors"
            >
              去登录
            </a>
          </div>
        )}
        <h4 className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5 shrink-0">
          <FileText className="w-3.5 h-3.5" /> 想法 — {selectedDate}
        </h4>
        <div className="flex gap-3 flex-1 min-h-0">
          {/* 左：新建想法 */}
          <div className="w-1/2 flex flex-col gap-2 overflow-y-auto">
            <input
              value={reviewTitle}
              onChange={e => setReviewTitle(e.target.value)}
              placeholder="标题（可选）"
              className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200
                         placeholder:text-gray-600 focus:outline-none focus:border-blue-500 transition-colors shrink-0"
            />
            <div className="flex gap-2 flex-1 min-h-0">
              {/* 左：想法内容 */}
              <div className="flex-1 flex flex-col gap-2">
                <textarea
                  value={reviewContent}
                  onChange={e => setReviewContent(e.target.value)}
                  placeholder="记录你的交易思路..."
                  rows={3}
                  className="flex-1 bg-[#0a0a0b] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200
                             placeholder:text-gray-600 focus:outline-none focus:border-blue-500 transition-colors resize-none min-h-[60px]"
                />
                <div className="flex items-start gap-2 shrink-0">
                  <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                    {reviewTags.map(t => (
                      <span
                        key={t.tag}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          color: t.color,
                          backgroundColor: t.color + '15'
                        }}
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
              {/* 右：标签选择器 */}
              <div className="w-28 shrink-0 flex flex-col gap-1 max-h-full">
                <span className="text-[10px] text-gray-500 font-medium shrink-0">
                  标签
                </span>
                <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
                  {reviewTags.map(t => (
                    <span
                      key={t.tag}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                      style={{color: t.color, backgroundColor: t.color + '15'}}
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
                          if (dragPresetIdx !== null && dragPresetIdx !== idx) {
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

          {/* 右：历史想法 */}
          <div className="w-1/2 border-l border-gray-700/30 pl-3 overflow-y-auto space-y-1">
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
                      {fmtDate(r.date)}
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
