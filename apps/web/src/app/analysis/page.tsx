'use client'

import {useCallback, useEffect, useState, useMemo, useRef} from 'react'
import {Activity, AlertCircle, RefreshCw, Key, Clock} from 'lucide-react'
import {api} from '@/lib/api'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Line,
  ComposedChart,
  Bar
} from 'recharts'
import type {
  EquityCurveData,
  EquityPoint,
  EquityPerformanceMetrics,
  StoredApiKey
} from '@nexttrade/shared'

// ─── 工具函数 ───
function fmt(n: number, d = 2): string {
  return n.toFixed(d)
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmt(n, 2)}%`
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoUTC(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

const RANGE_OPTIONS = [
  {label: '7天', days: 7},
  {label: '30天', days: 30},
  {label: '90天', days: 90},
  {label: '1年', days: 365},
  {label: '全部', days: 0}
] as const

const AUTO_REFRESH_INTERVAL = 30_000 // 30 秒

// ─── 交易所图标 ───
function ExchangeIcon({
  exchange,
  size = 14
}: {
  exchange: string
  size?: number
}) {
  const props = {width: size, height: size, viewBox: '0 0 32 32'}
  if (exchange === 'binance') {
    return (
      <svg {...props} fill="none">
        <circle cx="16" cy="16" r="15" fill="#F3BA2F" />
        <path
          d="M10.85 14.27L16 9.12l5.15 5.15 3-3L16 3.17l-8.15 8.1 3 3ZM6.17 16l3-3 3 3-3 3-3-3Zm10.3 5.15l-3-3-3 3 3 3 3-3Zm4.68-2.15-3-3 3-3 3 3-3 3Zm-5.15-3L16 14.27l1.73 1.73-1.73 1.73-1.73-1.73Z"
          fill="#fff"
        />
      </svg>
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded bg-gray-700"
      style={{width: size, height: size, fontSize: size * 0.6}}
    >
      {exchange[0]?.toUpperCase()}
    </span>
  )
}

// ─── Tooltip 组件 ───
function ChartTooltip({active, payload}: {active?: boolean; payload?: any[]}) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as EquityPoint | undefined
  if (!d) return null
  return (
    <div className="bg-[#18181b] border border-gray-700 rounded-xl px-4 py-3 shadow-xl text-xs space-y-1.5 z-50">
      <p className="text-muted-foreground">{d.date}</p>
      <p className="text-foreground font-mono">
        净值: <span className="font-semibold">{fmt(d.netValue)} USDT</span>
      </p>
      <p className={d.dailyPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
        日盈亏: {d.dailyPnl >= 0 ? '+' : ''}
        {fmt(d.dailyPnl)} USDT
      </p>
      <p
        className={
          d.cumulativeReturn >= 0 ? 'text-emerald-400' : 'text-red-400'
        }
      >
        累计收益: {fmtPct(d.cumulativeReturn)}
      </p>
      <p className="text-red-400">回撤: {fmt(d.drawdown, 2)}%</p>
      <p className="text-muted-foreground">
        累计盈亏: {fmt(d.cumulativePnl)} USDT
      </p>
    </div>
  )
}

// ─── 指标卡片 ───
function MetricCard({
  title,
  value,
  color,
  sub
}: {
  title: string
  value: string
  color: string
  sub?: string
}) {
  return (
    <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
      <p className="text-xs text-muted-foreground mb-1">{title}</p>
      <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── 迷你指标卡（用于性能指标密集展示） ───
function MiniMetricCard({
  title,
  value,
  color
}: {
  title: string
  value: string
  color: string
}) {
  return (
    <div className="bg-[#18181b] rounded-lg border border-gray-800 p-3">
      <p className="text-[10px] text-muted-foreground mb-0.5">{title}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
    </div>
  )
}

// ═══════════════════════════════════════
// 主页面
// ═══════════════════════════════════════
export default function AnalysisPage() {
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([])
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [dateRange, setDateRange] = useState<[string, string]>([
    daysAgoUTC(30),
    todayUTC()
  ])
  const [startDate, endDate] = dateRange
  const [data, setData] = useState<EquityCurveData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── 加载 API Key 列表 ───
  useEffect(() => {
    api
      .listApiKeys()
      .then(keys => {
        setApiKeys(keys)
        if (keys.length > 0) setSelectedKeyId(keys[0].id)
      })
      .catch(() => {})
  }, [])

  // ─── 加载数据 ───
  const loadData = useCallback(
    async (showLoading = true) => {
      if (!selectedKeyId) return
      if (showLoading) setLoading(true)
      setError(null)
      try {
        const result = await api.getEquityCurve({
          keyId: selectedKeyId,
          startDate,
          endDate
        })
        console.log(
          '[analysis] API result:',
          JSON.stringify(result).slice(0, 500)
        )
        setData(result)
        setLastRefresh(new Date().toLocaleTimeString('zh-CN', {hour12: false}))
      } catch (err) {
        setError((err as Error).message)
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [selectedKeyId, startDate, endDate]
  )

  // ─── 首次加载 / 参数变化 ───
  useEffect(() => {
    if (selectedKeyId) loadData()
  }, [loadData])
  useEffect(() => {
    setData(null)
  }, [selectedKeyId])

  // ─── 自动刷新 ───
  useEffect(() => {
    if (!autoRefresh || !selectedKeyId) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setInterval(() => loadData(false), AUTO_REFRESH_INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [autoRefresh, selectedKeyId, loadData])

  // ─── 时间范围切换 ───
  const handleRange = (days: number) => {
    if (days === 0) setDateRange(['2020-01-01', todayUTC()])
    else setDateRange([daysAgoUTC(days), todayUTC()])
  }

  // ─── 统计数据（兼容旧版字段） ───
  const stats = useMemo(() => {
    if (!data || data.points.length === 0) return null
    const pts = data.points
    const winDays = pts.filter(p => p.dailyPnl > 0).length
    const lossDays = pts.filter(p => p.dailyPnl < 0).length
    return {
      totalDays: pts.length,
      winDays,
      lossDays,
      maxDailyWin: Math.max(...pts.map(p => p.dailyPnl)),
      maxDailyLoss: Math.min(...pts.map(p => p.dailyPnl)),
      avgDailyPnl: pts.reduce((s, p) => s + p.dailyPnl, 0) / pts.length
    }
  }, [data])

  const selectedKey = apiKeys.find(k => k.id === selectedKeyId)
  const metrics = data?.metrics

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
      {/* ═══════ 控制栏 ═══════ */}
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-primary" />
            <h1 className="text-base font-semibold">实盘分析</h1>
            {lastRefresh && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {lastRefresh}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                autoRefresh
                  ? 'border-emerald-700 bg-emerald-900/20 text-emerald-400'
                  : 'border-gray-700 text-muted-foreground'
              }`}
            >
              {autoRefresh ? '自动 30s' : '手动'}
            </button>
            <button
              onClick={() => loadData()}
              disabled={loading || !selectedKeyId}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              刷新
            </button>
          </div>
        </div>

        {/* Key 选择器 */}
        {apiKeys.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {apiKeys.map(k => (
              <button
                key={k.id}
                onClick={() => setSelectedKeyId(k.id)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  selectedKeyId === k.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-700 text-muted-foreground hover:border-gray-500'
                }`}
              >
                <ExchangeIcon exchange={k.exchange} size={16} />
                {k.label && (
                  <span className="truncate max-w-[60px]">{k.label}</span>
                )}
                <Key className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[80px] hidden sm:inline">
                  {k.apiKey}
                </span>
              </button>
            ))}
          </div>
        )}

        {apiKeys.length === 0 && (
          <p className="text-xs text-yellow-400 mb-3">
            ⚠️ 请先在"API 密钥"页面添加交易所 Key
          </p>
        )}

        {/* 时间范围选择 */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-end gap-1">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => handleRange(opt.days)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                  (opt.days === 30 && startDate === daysAgoUTC(30)) ||
                  (opt.days === 0 && startDate === '2020-01-01') ||
                  (opt.days !== 0 &&
                    opt.days !== 30 &&
                    startDate === daysAgoUTC(opt.days))
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-gray-700 text-muted-foreground hover:border-gray-500'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">开始</p>
            <input
              type="date"
              value={startDate}
              onChange={e => setDateRange([e.target.value, endDate])}
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary [color-scheme:dark] w-28"
            />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">结束</p>
            <input
              type="date"
              value={endDate}
              onChange={e => setDateRange([startDate, e.target.value])}
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary [color-scheme:dark] w-28"
            />
          </div>
          {data?.source && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              数据源: {data.source === 'snapshot' ? '📸 快照' : '📊 成交推算'}
              {data.cachedAt && ' · 💾 缓存'}
            </span>
          )}
        </div>
      </div>

      {/* ═══════ 错误提示 ═══════ */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* ═══════ 加载状态 ═══════ */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ═══════ 空状态 ═══════ */}
      {!selectedKeyId && !loading && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <Key className="w-12 h-12 mb-3 opacity-20" />
          <p className="text-sm">请选择一个交易所 Key</p>
        </div>
      )}

      {selectedKeyId && !loading && !data && !error && (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
          加载中...
        </div>
      )}

      {/* ═══════ 数据展示（始终渲染图表区域） ═══════ */}
      {!loading && data && (
        <>
          {/* ─── 核心指标卡片 ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              title="当前净值"
              value={`${fmt(data.currentNetValue)} USDT`}
              color="text-foreground"
              sub={
                selectedKey
                  ? `${selectedKey.label || selectedKey.exchange}`
                  : ''
              }
            />
            <MetricCard
              title="累计收益率"
              value={fmtPct(data.totalReturn)}
              color={
                data.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'
              }
              sub={`初始 ${data.initialCapital} USDT`}
            />
            <MetricCard
              title="最大回撤"
              value={`${fmt(data.maxDrawdown, 2)}%`}
              color="text-red-400"
              sub={metrics ? `${metrics.drawdownDays} 天` : undefined}
            />
            <MetricCard
              title="累计盈亏"
              value={`${fmt(data.points[data.points.length - 1]?.cumulativePnl ?? 0)} USDT`}
              color={
                data.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'
              }
            />
          </div>

          {/* ─── 净值走势图 + 回撤区域 ─── */}
          <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
            <h3 className="text-sm font-medium mb-3">净值走势</h3>
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.points}>
                  <defs>
                    <linearGradient id="ng" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ddg" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#ef4444"
                        stopOpacity={0.25}
                      />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="date"
                    tick={{fill: '#a1a1aa', fontSize: 11}}
                    tickLine={false}
                    axisLine={{stroke: '#27272a'}}
                    minTickGap={40}
                  />
                  <YAxis
                    yAxisId="l"
                    orientation="left"
                    tick={{fill: '#a1a1aa', fontSize: 11}}
                    tickLine={false}
                    axisLine={{stroke: '#27272a'}}
                    domain={['auto', 'auto']}
                    tickFormatter={v => `${fmt(v)}`}
                  />
                  <YAxis
                    yAxisId="r"
                    orientation="right"
                    tick={{fill: '#a1a1aa', fontSize: 11}}
                    tickLine={false}
                    axisLine={{stroke: '#27272a'}}
                    domain={['auto', 'auto']}
                    tickFormatter={v => `${fmt(v)}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />

                  {/* 净值曲线（左轴） */}
                  <Area
                    yAxisId="l"
                    type="monotone"
                    dataKey="netValue"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#ng)"
                    dot={false}
                    activeDot={{r: 4, fill: '#6366f1'}}
                  />

                  {/* 累计收益率曲线（右轴） */}
                  <Line
                    yAxisId="r"
                    type="monotone"
                    dataKey="cumulativeReturn"
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{r: 3, fill: '#22c55e'}}
                  />

                  {/* 回撤填充区域（左轴，反转显示） */}
                  <Area
                    yAxisId="l"
                    type="monotone"
                    dataKey="drawdown"
                    stroke="#ef4444"
                    strokeWidth={1}
                    fill="url(#ddg)"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ─── 回撤详情图 ─── */}
          <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
            <h3 className="text-sm font-medium mb-3">回撤深度</h3>
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.points}>
                  <defs>
                    <linearGradient id="ddg2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop
                        offset="95%"
                        stopColor="#ef4444"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{fill: '#a1a1aa', fontSize: 10}}
                    tickLine={false}
                    axisLine={{stroke: '#27272a'}}
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{fill: '#a1a1aa', fontSize: 10}}
                    tickLine={false}
                    axisLine={{stroke: '#27272a'}}
                    domain={['auto', 0]}
                    tickFormatter={v => `${fmt(v, 1)}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="drawdown"
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    fill="url(#ddg2)"
                    dot={false}
                    activeDot={{r: 3, fill: '#ef4444'}}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ─── 每日盈亏柱状图 ─── */}
          <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
            <h3 className="text-sm font-medium mb-3">每日盈亏</h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="date"
                    tick={{fill: '#a1a1aa', fontSize: 10}}
                    tickLine={false}
                    axisLine={{stroke: '#27272a'}}
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{fill: '#a1a1aa', fontSize: 11}}
                    tickLine={false}
                    axisLine={{stroke: '#27272a'}}
                    tickFormatter={v => `${fmt(v)}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="#52525b" />
                  <Bar
                    dataKey="dailyPnl"
                    fill="#6366f1"
                    fillOpacity={0.7}
                    radius={[2, 2, 0, 0]}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ─── 增强性能指标 ─── */}
          {metrics && (
            <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-medium mb-3">性能指标</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                <MiniMetricCard
                  title="夏普比率"
                  value={
                    metrics.sharpeRatio > 0 ? fmt(metrics.sharpeRatio) : '0.00'
                  }
                  color={
                    metrics.sharpeRatio >= 1
                      ? 'text-emerald-400'
                      : metrics.sharpeRatio >= 0
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }
                />
                <MiniMetricCard
                  title="卡尔玛比率"
                  value={fmt(metrics.calmarRatio)}
                  color={
                    metrics.calmarRatio >= 1
                      ? 'text-emerald-400'
                      : metrics.calmarRatio >= 0
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }
                />
                <MiniMetricCard
                  title="年化收益率"
                  value={fmtPct(metrics.annualizedReturn)}
                  color={
                    metrics.annualizedReturn >= 0
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }
                />
                <MiniMetricCard
                  title="年化波动率"
                  value={fmtPct(metrics.annualizedVolatility)}
                  color="text-yellow-400"
                />
                <MiniMetricCard
                  title="胜率"
                  value={fmtPct(metrics.winRate)}
                  color={
                    metrics.winRate >= 50
                      ? 'text-emerald-400'
                      : 'text-yellow-400'
                  }
                />
                <MiniMetricCard
                  title="盈亏比"
                  value={fmt(metrics.profitLossRatio)}
                  color={
                    metrics.profitLossRatio >= 1.5
                      ? 'text-emerald-400'
                      : metrics.profitLossRatio >= 1
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }
                />
              </div>
            </div>
          )}

          {/* ─── 统计卡片（底部） ─── */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard
                title="交易天数"
                value={String(stats.totalDays)}
                sub={`盈利 ${stats.winDays} / 亏损 ${stats.lossDays}`}
                color="text-foreground"
              />
              <MetricCard
                title="日均盈亏"
                value={fmtPct(stats.avgDailyPnl)}
                color={
                  stats.avgDailyPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                }
              />
              <MetricCard
                title="最大单日盈利"
                value={fmt(stats.maxDailyWin, 2)}
                color="text-emerald-400"
              />
              <MetricCard
                title="最大单日亏损"
                value={fmt(stats.maxDailyLoss, 2)}
                color="text-red-400"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
