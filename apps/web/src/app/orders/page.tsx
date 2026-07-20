'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {
  ClipboardList,
  Key,
  TrendingUp,
  TrendingDown,
  Activity,
  Star,
  Save,
  Trash2,
  AlertCircle,
  LogIn,
  UserPlus,
  LogOut,
  Plus,
  Search
} from 'lucide-react'
import {api, getStoredUser, clearStoredUser} from '@/lib/api'
import type {
  AuthUser,
  StoredApiKey,
  TradeAuditRecord,
  TradeReview,
  TradeCandle,
  TradeMarker
} from '@nexttrade/shared'
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type CandlestickData,
  type Time
} from 'lightweight-charts'

// ─── 预设标签 ───
const STRATEGY_TAGS = [
  '突破追入',
  '回调接多',
  '趋势延续',
  '反转做空',
  'VWAP 回归',
  '支撑位接针',
  'Fib 回调',
  '成交量突破',
  '价格行为 (PA)',
  '形态突破',
  '均线金叉',
  '背离抄底'
]

const ERROR_TAGS = [
  '追高被套',
  '止损设太近',
  '止损设太远',
  '逆势死扛',
  '仓位过重',
  '入场过早',
  '出场过早',
  '出场过晚',
  '忽略大盘',
  'FOMO 入场',
  '未设止损',
  '扛单爆仓'
]

// ─── 工具函数 ───
function fmt(n: number, d = 2): string {
  return n.toFixed(d)
}

function fmtPnl(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`
}

// ─── 子组件: K 线图 ───
function TradeChart({
  candles,
  markers
}: {
  candles: TradeCandle[]
  markers: TradeMarker[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: {color: '#18181b'},
        textColor: '#a1a1aa'
      },
      grid: {
        vertLines: {color: '#27272a'},
        horzLines: {color: '#27272a'}
      },
      width: containerRef.current.clientWidth,
      height: 380,
      crosshair: {
        mode: 0
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
        secondsVisible: false
      },
      rightPriceScale: {
        borderColor: '#27272a'
      }
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e'
    })

    const cdlData: CandlestickData[] = candles.map(c => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))
    series.setData(cdlData)

    // 买卖点标记 (v5 使用 createSeriesMarkers)
    if (markers.length > 0) {
      createSeriesMarkers(
        series,
        markers.map(m => ({
          time: m.time as Time,
          position: m.position,
          color: m.color,
          shape: m.shape,
          text: m.text
        }))
      )
    }

    chartRef.current = chart

    // 自适应宽度
    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({width: containerRef.current.clientWidth})
      }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [candles, markers])

  if (candles.length === 0) {
    return (
      <div className="h-[380px] flex items-center justify-center text-gray-500 bg-[#18181b] rounded-xl border border-gray-800">
        <div className="text-center">
          <Activity className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">运行分析后将显示 K 线图</p>
        </div>
      </div>
    )
  }

  return <div ref={containerRef} className="rounded-xl overflow-hidden" />
}

// ─── 子组件: 诊断卡片 ───
function MetricCard({
  title,
  value,
  sub,
  color
}: {
  title: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
      <p className="text-xs text-muted-foreground mb-1">{title}</p>
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

// ─── 子组件: 星级评分 ───
function StarRating({
  value,
  onChange
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`p-1 transition-colors ${
            i <= value ? 'text-yellow-400' : 'text-gray-600'
          } hover:text-yellow-400`}
        >
          <Star className="w-5 h-5 fill-current" />
        </button>
      ))}
    </div>
  )
}

// ─── 子组件: 标签多选 ───
function TagSelect({
  tags,
  selected,
  onChange,
  label
}: {
  tags: string[]
  selected: string[]
  onChange: (t: string[]) => void
  label: string
}) {
  const toggle = (tag: string) => {
    if (selected.includes(tag)) {
      onChange(selected.filter(t => t !== tag))
    } else {
      onChange([...selected, tag])
    }
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(tag => {
          const active = selected.includes(tag)
          return (
            <button
              key={tag}
              onClick={() => toggle(tag)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                active
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-transparent border-gray-700 text-muted-foreground hover:border-gray-500'
              }`}
            >
              {tag}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── 子组件: 登录/注册 ───
function AuthForm({onAuth}: {onAuth: () => void}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (mode === 'register') {
        await api.register(username, password)
      } else {
        await api.login(username, password)
      }
      onAuth()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-20">
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-6">
          {mode === 'login' ? (
            <LogIn className="w-6 h-6 text-primary" />
          ) : (
            <UserPlus className="w-6 h-6 text-primary" />
          )}
          <h2 className="text-lg font-semibold">
            {mode === 'login' ? '登录' : '注册'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="用户名"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-primary transition-colors"
              minLength={3}
              required
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-primary transition-colors"
              minLength={6}
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium
                       hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <p className="mt-4 text-xs text-center text-muted-foreground">
          {mode === 'login' ? '没有账号？' : '已有账号？'}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className="text-primary hover:underline ml-1"
          >
            {mode === 'login' ? '注册' : '登录'}
          </button>
        </p>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// 主页面
// ══════════════════════════════════════════════════

export default function OrdersPage() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // ─── API Key 状态 ───
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([])
  const [showAddKey, setShowAddKey] = useState(false)
  const [newKeyEx, setNewKeyEx] = useState('binance')
  const [newKey, setNewKey] = useState('')
  const [newSecret, setNewSecret] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(false)

  // ─── 分析参数 ───
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [symbol, setSymbol] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10)
  })
  const [orderId, setOrderId] = useState('')

  // ─── 分析结果 ───
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [records, setRecords] = useState<TradeAuditRecord[]>([])
  const [candles, setCandles] = useState<TradeCandle[]>([])
  const [markers, setMarkers] = useState<TradeMarker[]>([])
  const [totalPnl, setTotalPnl] = useState(0)
  const [totalFee, setTotalFee] = useState(0)
  const [winRate, setWinRate] = useState(0)
  const [tradeCount, setTradeCount] = useState(0)
  const [tradeVolume, setTradeVolume] = useState(0)
  const [selectedTrade, setSelectedTrade] = useState<TradeAuditRecord | null>(
    null
  )

  // ─── 复盘状态 ───
  const [strategyTags, setStrategyTags] = useState<string[]>([])
  const [errorTags, setErrorTags] = useState<string[]>([])
  const [rating, setRating] = useState(3)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [savedReviews, setSavedReviews] = useState<TradeReview[]>([])
  const [showReviews, setShowReviews] = useState(false)

  // ─── 初始化：检查登录状态 ───
  useEffect(() => {
    const stored = getStoredUser()
    setUser(stored)
    setLoading(false)
  }, [])

  // 登录后自动加载 API Key
  const handleAuth = useCallback(() => {
    const stored = getStoredUser()
    setUser(stored)
    if (stored) loadKeys()
  }, [])

  const handleLogout = () => {
    clearStoredUser()
    api.logout()
    setUser(null)
    setApiKeys([])
    setRecords([])
    setCandles([])
    setMarkers([])
  }

  // ─── 加载 API Key ───
  const loadKeys = useCallback(async () => {
    try {
      const keys = await api.listApiKeys()
      setApiKeys(keys)
      if (keys.length > 0 && !selectedKeyId) {
        setSelectedKeyId(keys[0].id)
      }
    } catch {
      // ignore
    }
  }, [selectedKeyId])

  // ─── 添加 API Key ───
  const handleAddKey = async () => {
    setKeyLoading(true)
    setKeyError(null)
    try {
      await api.storeApiKey(newKeyEx, newKey, newSecret)
      setShowAddKey(false)
      setNewKey('')
      setNewSecret('')
      await loadKeys()
    } catch (err) {
      setKeyError((err as Error).message)
    } finally {
      setKeyLoading(false)
    }
  }

  // ─── 删除 API Key ───
  const handleDeleteKey = async (id: number) => {
    try {
      await api.deleteApiKey(id)
      await loadKeys()
      if (selectedKeyId === id) setSelectedKeyId(null)
    } catch {
      // ignore
    }
  }

  // ─── 运行分析 ───
  const handleAnalyze = async () => {
    if (!selectedKeyId) return
    setAnalyzing(true)
    setAnalyzeError(null)
    setRecords([])
    setCandles([])
    setMarkers([])
    setSelectedTrade(null)

    try {
      const result = await api.analyzeTrades({
        keyId: selectedKeyId,
        symbol: symbol || undefined,
        startDate,
        endDate,
        orderId: orderId || undefined
      })
      setRecords(result.records)
      setTotalPnl(result.totalPnl)
      setTotalFee(result.totalFee)
      setWinRate(result.winRate)
      setTradeCount(result.tradeCount)
      setTradeVolume(result.tradeVolume)
      setCandles((result as any).candles ?? [])
      setMarkers((result as any).markers ?? [])
      if (result.records.length > 0) {
        setSelectedTrade(result.records[0])
        setStrategyTags([])
        setErrorTags([])
        setRating(3)
        setNotes('')
      }
    } catch (err) {
      setAnalyzeError((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  // ─── 保存复盘 ───
  const handleSaveReview = async () => {
    if (!selectedTrade) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await api.saveReview({
        tradeAuditId: selectedTrade.id,
        symbol: selectedTrade.symbol,
        strategyTags,
        errorTags,
        rating,
        notes
      })
      setSaveMsg('复盘已保存 ✓')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setSaveMsg(`保存失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  // ─── 加载复盘列表 ───
  const loadReviews = async () => {
    try {
      const reviews = await api.listReviews()
      setSavedReviews(reviews)
      setShowReviews(true)
    } catch {
      // ignore
    }
  }

  // ─── 选择交易记录时填充复盘表单 ───
  const selectTradeForReview = (record: TradeAuditRecord) => {
    setSelectedTrade(record)
    const existing = savedReviews.find(r => r.tradeAuditId === record.id)
    if (existing) {
      setStrategyTags(existing.strategyTags)
      setErrorTags(existing.errorTags)
      setRating(existing.rating)
      setNotes(existing.notes)
    } else {
      setStrategyTags([])
      setErrorTags([])
      setRating(3)
      setNotes('')
    }
  }

  // ─── 加载中 ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─── 未登录 ───
  if (!user) {
    return <AuthForm onAuth={handleAuth} />
  }

  // ══════════════════════════════════════════════
  // 已登录: 主界面
  // ══════════════════════════════════════════════
  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* ─── 顶栏：用户 + Key 管理 ─── */}
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-5 h-5 text-primary" />
            <h1 className="text-base font-semibold">订单分析</h1>
            <span className="text-xs text-muted-foreground">
              @{user.username}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddKey(!showAddKey)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary
                         hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {apiKeys.length === 0 ? '添加 API Key' : '添加 Key'}
            </button>
            <button
              onClick={loadReviews}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-muted-foreground
                         hover:text-foreground transition-colors"
            >
              复盘记录
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-red-400
                         hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              退出
            </button>
          </div>
        </div>

        {/* 添加 Key 表单 */}
        {showAddKey && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="text-xs text-muted-foreground mb-1">API Key</p>
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="binance API Key"
                  className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <p className="text-xs text-muted-foreground mb-1">Secret Key</p>
                <input
                  type="password"
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  placeholder="binance Secret Key"
                  className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary"
                />
              </div>
              <button
                onClick={handleAddKey}
                disabled={keyLoading || !newKey || !newSecret}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-primary text-white
                           hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                {keyLoading ? '校验中…' : '校验并保存'}
              </button>
            </div>
            {keyError && (
              <div className="flex items-center gap-2 mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {keyError}
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              ⚠️ 请确保 API Key 在币安后台设置为
              <strong>仅只读 (Read-Only)</strong>，禁用交易权限
            </p>
          </div>
        )}

        {/* Key 列表 */}
        {apiKeys.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {apiKeys.map(k => (
              <div
                key={k.id}
                onClick={() => setSelectedKeyId(k.id)}
                className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-all
                  ${
                    selectedKeyId === k.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-700 text-muted-foreground hover:border-gray-500'
                  }`}
              >
                <Key className="w-3 h-3" />
                {k.apiKey}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    handleDeleteKey(k.id)
                  }}
                  className="text-gray-600 hover:text-red-400 ml-1"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 分析参数面板 ─── */}
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">交易对 (可选)</p>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="如 BTC/USDT:USDT"
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm w-40
                         focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">开始日期</p>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm w-36
                         focus:outline-none focus:border-primary [color-scheme:dark]"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">结束日期</p>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm w-36
                         focus:outline-none focus:border-primary [color-scheme:dark]"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">订单 ID (可选)</p>
            <input
              value={orderId}
              onChange={e => setOrderId(e.target.value)}
              placeholder="按订单 ID 查询"
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm w-36
                         focus:outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !selectedKeyId}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-primary text-white
                       hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Search className="w-4 h-4" />
            {analyzing ? '分析中…' : '运行分析'}
          </button>
        </div>

        {!selectedKeyId && apiKeys.length === 0 && (
          <p className="mt-2 text-xs text-yellow-400">
            ⚠️ 请先添加并选择一个 Binance API Key
          </p>
        )}

        <p className="mt-2 text-[10px] text-muted-foreground">
          ⏰ 币安仅保留近 3 个月的 U 本位合约成交记录 · 单次查询最多 31 天
        </p>

        {analyzeError && (
          <div className="flex items-center gap-2 mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {analyzeError}
          </div>
        )}
      </div>

      {/* ─── 7:5 双栏布局 ─── */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* ═══ 左栏 (7/12): K 线 + 诊断 ═══ */}
        <div className="lg:w-7/12 space-y-4">
          {/* K 线图 */}
          <TradeChart candles={candles} markers={markers} />

          {/* 诊断卡片 */}
          {tradeCount > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard
                title="总盈亏"
                value={`${fmtPnl(totalPnl)} USDT`}
                sub={`手续费: ${fmt(totalFee)} USDT`}
                color={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              <MetricCard
                title="胜率"
                value={`${fmt(winRate, 1)}%`}
                sub={`${tradeCount} 笔交易`}
                color="text-blue-400"
              />
              <MetricCard
                title="总成交量"
                value={fmt(tradeVolume, 4)}
                sub={symbol || '合约'}
                color="text-purple-400"
              />
              <MetricCard
                title="平均盈亏"
                value={`${fmtPnl(tradeCount > 0 ? totalPnl / tradeCount : 0)}`}
                sub="每笔平均"
                color={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
            </div>
          )}

          {/* MAE/MFE 详情 */}
          {records.length > 0 && (
            <div className="bg-[#18181b] rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h3 className="text-sm font-medium">交易明细</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-muted-foreground">
                      <th className="text-left px-3 py-2">Symbol</th>
                      <th className="text-center px-3 py-2">方向</th>
                      <th className="text-right px-3 py-2">入场</th>
                      <th className="text-right px-3 py-2">出场</th>
                      <th className="text-right px-3 py-2">PnL</th>
                      <th className="text-right px-3 py-2">MAE%</th>
                      <th className="text-right px-3 py-2">MFE%</th>
                      <th className="text-right px-3 py-2">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr
                        key={r.id}
                        onClick={() => selectTradeForReview(r)}
                        className={`border-b border-gray-800/50 cursor-pointer transition-colors hover:bg-gray-800/30
                          ${selectedTrade?.id === r.id ? 'bg-primary/5' : ''}`}
                      >
                        <td className="px-3 py-2 font-medium">
                          {r.symbol.replace('/USDT:USDT', '')}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.side === 'buy' ? (
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-400 inline" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5 text-red-400 inline" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {fmt(r.entryPrice)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {fmt(r.exitPrice)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono font-medium ${r.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {fmtPnl(r.realizedPnl)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">
                          {fmt(r.mae, 2)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-400">
                          {fmt(r.mfe, 2)}%
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {r.closedAt.slice(5, 16)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 无数据提示 */}
          {tradeCount === 0 && !analyzing && !analyzeError && (
            <div className="flex flex-col items-center justify-center h-[40vh] text-muted-foreground">
              <Activity className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">选择参数后点击"运行分析"</p>
              <p className="text-xs mt-1">
                系统将自动拉取 Binance 成交记录并计算 MAE/MFE
              </p>
            </div>
          )}

          {analyzing && (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">正在分析交易数据…</span>
              </div>
            </div>
          )}
        </div>

        {/* ═══ 右栏 (5/12): 复盘表单 ═══ */}
        <div className="lg:w-5/12 space-y-4">
          {selectedTrade ? (
            <>
              {/* 选中交易摘要 */}
              <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                <h3 className="text-sm font-medium mb-3">当前复盘交易</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">交易对</span>
                    <p className="font-mono font-medium">
                      {selectedTrade.symbol}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">方向</span>
                    <p
                      className={
                        selectedTrade.side === 'buy'
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }
                    >
                      {selectedTrade.side === 'buy' ? '做多' : '做空'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">入场 / 出场</span>
                    <p className="font-mono">
                      {fmt(selectedTrade.entryPrice)} →{' '}
                      {fmt(selectedTrade.exitPrice)}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">盈亏</span>
                    <p
                      className={`font-mono font-medium ${selectedTrade.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {fmtPnl(selectedTrade.realizedPnl)} USDT
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      MAE (最大浮亏)
                    </span>
                    <p className="font-mono text-red-400">
                      {fmt(selectedTrade.mae, 2)}%
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      MFE (最大浮盈)
                    </span>
                    <p className="font-mono text-emerald-400">
                      {fmt(selectedTrade.mfe, 2)}%
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">时间</span>
                    <p className="font-mono text-xs">
                      {selectedTrade.openedAt.slice(0, 19)} →{' '}
                      {selectedTrade.closedAt.slice(0, 19)}
                    </p>
                  </div>
                </div>
              </div>

              {/* 策略标签 */}
              <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                <TagSelect
                  label="交易策略 (可多选)"
                  tags={STRATEGY_TAGS}
                  selected={strategyTags}
                  onChange={setStrategyTags}
                />
              </div>

              {/* 错误标签 */}
              <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                <TagSelect
                  label="错误类型 (可多选)"
                  tags={ERROR_TAGS}
                  selected={errorTags}
                  onChange={setErrorTags}
                />
              </div>

              {/* 评分 */}
              <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                <p className="text-xs text-muted-foreground mb-2">交易评分</p>
                <StarRating value={rating} onChange={setRating} />
              </div>

              {/* Markdown 笔记 */}
              <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                <p className="text-xs text-muted-foreground mb-2">
                  复盘笔记 (支持 Markdown)
                </p>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="写下你的复盘思考…"
                  rows={6}
                  className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary resize-none font-mono"
                />
              </div>

              {/* 提交 */}
              <button
                onClick={handleSaveReview}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 text-sm px-4 py-3 rounded-xl
                           bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Save className="w-4 h-4" />
                {saving ? '保存中…' : '保存复盘'}
              </button>

              {saveMsg && (
                <div
                  className={`text-xs text-center px-3 py-2 rounded-lg ${
                    saveMsg.includes('✓')
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {saveMsg}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground bg-[#18181b] rounded-xl border border-gray-800">
              <ClipboardList className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">选择一条交易记录开始复盘</p>
              <p className="text-xs mt-1">在左侧交易明细表中点击任意行</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── 复盘记录弹窗 ─── */}
      {showReviews && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20 px-4">
          <div className="bg-[#18181b] rounded-xl border border-gray-800 w-full max-w-2xl max-h-[70vh] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h3 className="text-sm font-medium">复盘记录</h3>
              <button
                onClick={() => setShowReviews(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3 max-h-[55vh]">
              {savedReviews.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  暂无复盘记录
                </p>
              ) : (
                savedReviews.map(r => (
                  <div
                    key={r.id}
                    className="bg-[#0a0a0b] rounded-lg border border-gray-800 p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{r.symbol}</span>
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {Array.from({length: 5}).map((_, i) => (
                            <Star
                              key={i}
                              className={`w-3 h-3 ${i < r.rating ? 'text-yellow-400' : 'text-gray-600'}`}
                              fill="currentColor"
                            />
                          ))}
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await api.deleteReview(r.id)
                              loadReviews()
                            } catch {}
                          }}
                          className="text-gray-600 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {r.strategyTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {r.strategyTags.map(t => (
                          <span
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.errorTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {r.errorTags.map(t => (
                          <span
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.notes && (
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">
                        {r.notes}
                      </p>
                    )}
                    <p className="text-[10px] text-gray-600 mt-2">
                      {r.createdAt.slice(0, 19)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
