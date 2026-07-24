'use client'

import {useCallback, useEffect, useMemo, useState} from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts'
import {
  Wallet,
  TrendingUp,
  Landmark,
  PiggyBank,
  Activity,
  Gauge,
  AlertCircle,
  Percent,
  History
} from 'lucide-react'
import {authHeaders, API_ORIGIN, getToken} from '@/lib/api'
import type {
  AssetCurrent,
  AssetTodayExtremes,
  AssetDailyOHLC
} from '@nexttrade/shared'

// ─── 法币配置 ───
const FX_RATES: Record<string, number> = {
  USD: 1,
  CNY: 7.25,
  EUR: 0.92,
  JPY: 153.5,
  GBP: 0.79
}
const FX_SYMBOLS: Record<string, string> = {
  USD: '$',
  CNY: '¥',
  EUR: '€',
  JPY: '¥',
  GBP: '£'
}

function fmt(n: number, currency = 'USD'): string {
  if (!Number.isFinite(n)) return '0.00'
  const v = n * (FX_RATES[currency] ?? 1)
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'K'
  return v.toFixed(2)
}

function fmtFull(n: number, currency = 'USD'): string {
  if (!Number.isFinite(n)) return `${FX_SYMBOLS[currency] ?? '$'}0.00`
  const v = n * (FX_RATES[currency] ?? 1)
  const sym = FX_SYMBOLS[currency] ?? '$'
  return (
    sym +
    v.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  )
}

function fmtTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '--'
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})
}

// 图表时间轴：只显示整点 (HH:00)
function fmtHour(isoStr: string): string {
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  const h = d.getHours().toString().padStart(2, '0')
  return `${h}:00`
}

function fmtDate(isoStr: string): string {
  const d = new Date(isoStr + 'T00:00:00Z')
  return d.toLocaleDateString('zh-CN', {month: 'short', day: 'numeric'})
}

const MODULE_COLORS: Record<string, string> = {
  fundingVal: '#10b981',
  spotVal: '#3b82f6',
  futuresUVal: '#8b5cf6',
  futuresCoinVal: '#f59e0b',
  earnVal: '#ef4444'
}
const MODULE_LABELS: Record<string, string> = {
  fundingVal: '资金',
  spotVal: '现货',
  futuresUVal: 'U合约',
  futuresCoinVal: '币合约',
  earnVal: '理财'
}
const MODULE_ICONS: Record<string, any> = {
  fundingVal: Landmark,
  spotVal: Wallet,
  futuresUVal: Gauge,
  futuresCoinVal: Gauge,
  earnVal: PiggyBank
}

type TimeRange = '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | 'all'
const RANGE_DAYS: Record<TimeRange, number> = {
  '1d': 1,
  '1w': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  all: 9999
}
const RANGE_LABELS: Record<TimeRange, string> = {
  '1d': '天',
  '1w': '周',
  '1m': '月',
  '3m': '3月',
  '6m': '半年',
  '1y': '一年',
  all: '全部'
}

export default function AssetPage() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [initDone, setInitDone] = useState(false)
  const [currentAssets, setCurrentAssets] = useState<Record<
    number,
    AssetCurrent
  > | null>(null)
  const [todayData, setTodayData] = useState<any[]>([])
  const [ohlcData, setOhlcData] = useState<AssetDailyOHLC[]>([])
  const [keyIds, setKeyIds] = useState<number[]>([])
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [timeRange, setTimeRange] = useState<TimeRange>('3m')
  const [chartMode, setChartMode] = useState<'value' | 'roi'>('value')

  useEffect(() => {
    setLoggedIn(!!getToken())
    setInitDone(true)
  }, [])

  const days = RANGE_DAYS[timeRange]
  const fetchAll = useCallback(async () => {
    if (!loggedIn) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [curRes, todayRes, histRes] = await Promise.all([
        fetch(`${API_ORIGIN}/api/asset/current`, {headers: authHeaders()}),
        fetch(`${API_ORIGIN}/api/asset/today`, {headers: authHeaders()}),
        fetch(`${API_ORIGIN}/api/asset/history?days=${days}`, {
          headers: authHeaders()
        })
      ])
      const curJson = await curRes.json()
      const todayJson = await todayRes.json()
      const histJson = await histRes.json()

      if (curJson.success) {
        const keys = Object.keys(curJson.data).map(Number).sort()
        setCurrentAssets(curJson.data)
        setKeyIds(keys)
        if (keys.length > 0 && !selectedKeyId) setSelectedKeyId(keys[0])
      }
      if (todayJson.success) setTodayData(todayJson.data)
      if (histJson.success) {
        const allData = Array.isArray(histJson.data)
          ? histJson.data
          : [histJson.data]
        const merged = new Map<string, AssetDailyOHLC>()
        for (const entry of allData) {
          if (!entry.ohlc) continue
          for (const o of entry.ohlc) {
            const existing = merged.get(o.date)
            if (existing) {
              existing.openVal += o.openVal
              existing.highVal += o.highVal
              existing.lowVal += o.lowVal
              existing.closeVal += o.closeVal
            } else merged.set(o.date, {...o})
          }
        }
        setOhlcData(
          Array.from(merged.values()).sort((a, b) =>
            a.date.localeCompare(b.date)
          )
        )
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loggedIn, days, selectedKeyId])

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [fetchAll])

  const currentKeyAsset = selectedKeyId ? currentAssets?.[selectedKeyId] : null
  const selectedToday = useMemo(() => {
    if (!todayData?.length) return null
    if (selectedKeyId)
      return todayData.find((d: any) => d.keyId === selectedKeyId) ?? null
    return todayData[0] ?? null
  }, [todayData, selectedKeyId])
  const extremes: AssetTodayExtremes | null = selectedToday?.extremes ?? null
  const intraday = selectedToday?.intraday ?? []

  const pieData = useMemo(() => {
    if (!currentKeyAsset) return []
    return Object.entries(MODULE_COLORS)
      .map(([key, color]) => ({
        name: MODULE_LABELS[key],
        value: (currentKeyAsset as any)[key] ?? 0,
        color
      }))
      .filter(i => i.value > 0)
  }, [currentKeyAsset])

  const amplitude = extremes?.lowVal
    ? ((extremes.highVal - extremes.lowVal) / extremes.lowVal) * 100
    : 0

  // ─── 较昨日对比 ───
  const yesterdayChange = useMemo(() => {
    if (ohlcData.length < 2) return null
    const yesterday = ohlcData[ohlcData.length - 2]
    const current = currentKeyAsset?.totalNetVal ?? 0
    const diff = current - yesterday.closeVal
    const pct = yesterday.closeVal > 0 ? (diff / yesterday.closeVal) * 100 : 0
    return {diff, pct}
  }, [ohlcData, currentKeyAsset])

  // ─── 累计收益额 / ROI / 历史最大回撤 ───
  const {cumPnl, roi, maxDrawdown} = useMemo(() => {
    if (!currentKeyAsset || ohlcData.length === 0)
      return {cumPnl: 0, roi: 0, maxDrawdown: 0}
    const first = ohlcData[0].openVal
    const current = currentKeyAsset.totalNetVal
    const netDep = currentKeyAsset.netDeposit ?? 0
    const adjustedCurrent = current - netDep // 剔除出入金干扰
    const pnl = adjustedCurrent - first
    const roiVal = first > 0 ? (pnl / first) * 100 : 0

    let peak = ohlcData[0].highVal
    let mdd = 0
    for (const o of ohlcData) {
      if (o.highVal > peak) peak = o.highVal
      const dd = peak > 0 ? ((peak - o.lowVal) / peak) * 100 : 0
      if (dd > mdd) mdd = dd
    }
    return {cumPnl: pnl, roi: roiVal, maxDrawdown: mdd}
  }, [currentKeyAsset, ohlcData])

  // ─── 走势图数据（完整时间网格，无数据补0） ───
  const chartData = useMemo(() => {
    const days = RANGE_DAYS[timeRange]

    if (timeRange === '1d') {
      const hourMap = new Map<string, number>()
      for (const d of intraday) hourMap.set(fmtHour(d.time), d.value)
      const now = new Date()
      const labels: string[] = []
      for (let i = 23; i >= 0; i--) {
        const h = ((now.getHours() - i + 24) % 24).toString().padStart(2, '0')
        labels.push(`${h}:00`)
      }
      const first = intraday.length > 0 ? intraday[0].value : 0
      return labels.map(label => {
        const v = hourMap.get(label) ?? 0
        return {
          label,
          value: v,
          closeVal: v,
          highVal: v,
          lowVal: v,
          pnl: v - first,
          roiPct: first > 0 ? ((v - first) / first) * 100 : 0,
          amplitude: 0
        }
      })
    }

    // 日级别：构建完整日期网格
    const ohlcMap = new Map<string, (typeof ohlcData)[0]>()
    for (const o of ohlcData) ohlcMap.set(o.date, o)

    const today = new Date()
    const labels: string[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() - i)
      labels.push(d.toISOString().slice(0, 10))
    }

    const firstClose = ohlcData.length > 0 ? ohlcData[0].closeVal : 0
    return labels.map(date => {
      const o = ohlcMap.get(date)
      const cv = o?.closeVal ?? 0
      return {
        label: fmtDate(date),
        value: cv,
        closeVal: cv,
        highVal: o?.highVal ?? 0,
        lowVal: o?.lowVal ?? 0,
        pnl: cv - firstClose,
        roiPct: firstClose > 0 ? ((cv - firstClose) / firstClose) * 100 : 0,
        amplitude: o?.amplitude ?? 0
      }
    })
  }, [timeRange, intraday, ohlcData])

  if (!initDone) return null

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Wallet className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">资产分析</h1>
        </div>
        <div className="flex items-center gap-1 bg-[#18181b] border border-gray-800 rounded-lg p-0.5">
          {Object.keys(FX_RATES).map(code => (
            <button
              key={code}
              onClick={() => setCurrency(code)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${currency === code ? 'bg-primary/15 text-primary font-medium' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {code}
            </button>
          ))}
          <button
            onClick={() => {
              setLoading(true)
              fetchAll()
            }}
            className="px-2 py-1 text-xs rounded-md text-gray-400 hover:text-gray-200 transition-colors border-l border-gray-800 ml-1 pl-2"
          >
            刷新
          </button>
        </div>
      </div>

      {initDone && !loggedIn && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-3 text-sm text-amber-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> 请先登录
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-3 mb-4 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center py-20 text-sm text-gray-500">
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse mr-2" />
          加载中...
        </div>
      )}

      {!loading && loggedIn && (
        <>
          {keyIds.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {keyIds.map(kid => (
                <button
                  key={kid}
                  onClick={() => setSelectedKeyId(kid)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${selectedKeyId === kid ? 'bg-primary/15 text-primary font-medium border border-primary/30' : 'bg-[#18181b] border border-gray-800 text-gray-400 hover:text-gray-200'}`}
                >
                  Key #{kid}
                </button>
              ))}
            </div>
          )}

          {currentKeyAsset && currentKeyAsset.snapshotAt === null && (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl mb-6">
              <Wallet className="w-10 h-10 mb-3 opacity-30" />
              <p>{currentKeyAsset.label || `Key #${selectedKeyId}`} 已绑定</p>
              <p className="text-xs text-gray-600 mt-1">
                等待首次资产采集...（每 5 分钟自动执行）
              </p>
            </div>
          )}

          {currentKeyAsset && currentKeyAsset.snapshotAt !== null && (
            <>
              {/* ═══ 第一行：总资产(含振幅+较昨日) + 五大分资产 ═══ */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3">
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">
                    总资产 ({currency})
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {fmtFull(currentKeyAsset.totalNetVal, currency)}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[9px]">
                    <span
                      className={`${amplitude > 5 ? 'text-red-400' : amplitude > 2 ? 'text-amber-400' : 'text-gray-500'}`}
                    >
                      <Activity className="w-2.5 h-2.5 inline mr-0.5" />
                      {extremes ? `${amplitude.toFixed(2)}%` : '--'}
                    </span>
                    {yesterdayChange && (
                      <span
                        className={
                          yesterdayChange.diff >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }
                      >
                        较昨 {yesterdayChange.diff >= 0 ? '+' : ''}
                        {yesterdayChange.pct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-gray-600 mt-0.5">
                    {fmtTime(currentKeyAsset.snapshotAt)}
                    {currentKeyAsset.wsUpdateAt && (
                      <span className="ml-1 text-emerald-500">●</span>
                    )}
                  </p>
                </div>
                {Object.keys(MODULE_LABELS).map(key => {
                  const Icon = MODULE_ICONS[key]
                  return (
                    <div
                      key={key}
                      className="bg-[#18181b] rounded-xl border border-gray-800 p-3"
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <Icon
                          className="w-3 h-3"
                          style={{color: MODULE_COLORS[key]}}
                        />
                        <p className="text-[10px] text-muted-foreground">
                          {MODULE_LABELS[key]}
                        </p>
                      </div>
                      <p className="text-sm font-bold tabular-nums">
                        {fmt((currentKeyAsset as any)[key] ?? 0, currency)}
                      </p>
                    </div>
                  )
                })}
              </div>

              {/* ═══ 第二行：分析指标 ═══ */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">
                    累计收益额
                  </p>
                  <p
                    className={`text-sm font-bold tabular-nums ${cumPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {fmtFull(cumPnl, currency)}
                  </p>
                  {(currentKeyAsset?.netDeposit ?? 0) !== 0 && (
                    <p className="text-[8px] text-gray-600 mt-0.5">
                      净入金 {fmtFull(currentKeyAsset!.netDeposit!, currency)}
                    </p>
                  )}
                </div>
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Percent className="w-3 h-3 text-gray-500" />
                    <p className="text-[10px] text-muted-foreground">
                      累计收益率 (ROI)
                    </p>
                  </div>
                  <p
                    className={`text-sm font-bold tabular-nums ${roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {roi.toFixed(2)}%
                  </p>
                </div>
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3">
                  <div className="flex items-center gap-1 mb-0.5">
                    <History className="w-3 h-3 text-gray-500" />
                    <p className="text-[10px] text-muted-foreground">
                      历史最大回撤 (MDD)
                    </p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-red-400">
                    {maxDrawdown.toFixed(2)}%
                  </p>
                </div>
              </div>

              {/* ═══ 第三行：走势图 + 饼图 ═══ */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
                <div className="lg:col-span-3 bg-[#18181b] rounded-xl border border-gray-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-medium">
                        {chartMode === 'value'
                          ? `资产走势 (${currency})`
                          : '收益率走势'}
                      </h2>
                      <button
                        onClick={() =>
                          setChartMode(chartMode === 'value' ? 'roi' : 'value')
                        }
                        className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${chartMode === 'roi' ? 'bg-emerald-500/20 text-emerald-400 font-medium' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                      >
                        ROI
                      </button>
                    </div>
                    <div className="flex items-center gap-1 bg-[#18181b] border border-gray-800 rounded-lg p-0.5">
                      {(Object.keys(RANGE_LABELS) as TimeRange[]).map(r => (
                        <button
                          key={r}
                          onClick={() => setTimeRange(r)}
                          className={`px-2 py-1 text-xs rounded-md transition-colors ${timeRange === r ? 'bg-primary/15 text-primary font-medium' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                          {RANGE_LABELS[r]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {chartData.length > 1 ? (
                    <div className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={chartData}
                          margin={{top: 20, right: 10, left: 0, bottom: 5}}
                        >
                          <defs>
                            <linearGradient
                              id="colorChart"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor={
                                  chartMode === 'roi' ? '#4ade80' : '#3b82f6'
                                }
                                stopOpacity={0.3}
                              />
                              <stop
                                offset="95%"
                                stopColor={
                                  chartMode === 'roi' ? '#4ade80' : '#3b82f6'
                                }
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#27272a"
                          />
                          <XAxis
                            dataKey="label"
                            interval={
                              timeRange === '1d' ? 1 : 'preserveStartEnd'
                            }
                            tick={{fontSize: 10, fill: '#71717a'}}
                            axisLine={{stroke: '#27272a'}}
                            tickLine={false}
                          />
                          <YAxis
                            tickFormatter={v =>
                              chartMode === 'value'
                                ? fmt(v / (FX_RATES[currency] ?? 1), currency)
                                : `${v.toFixed(1)}%`
                            }
                            tick={{fontSize: 10, fill: '#71717a'}}
                            axisLine={false}
                            tickLine={false}
                            width={chartMode === 'value' ? 60 : 50}
                          />
                          <Tooltip
                            content={({active, payload}: any) => {
                              if (!active || !payload?.length) return null
                              const d = payload[0].payload
                              const rate = FX_RATES[currency] ?? 1
                              const full = (n: number) =>
                                fmtFull(n / rate, currency)
                              return (
                                <div
                                  style={{
                                    backgroundColor: '#18181b',
                                    border: '1px solid #27272a',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    padding: '8px 12px'
                                  }}
                                >
                                  <div
                                    style={{
                                      color: '#a1a1aa',
                                      marginBottom: 4,
                                      fontSize: 11
                                    }}
                                  >
                                    {d.label}
                                  </div>
                                  {chartMode === 'roi' ? (
                                    <>
                                      <div
                                        style={{
                                          color: '#4ade80',
                                          fontWeight: 700,
                                          fontSize: 16,
                                          marginBottom: 2
                                        }}
                                      >
                                        {d.roiPct >= 0 ? '+' : ''}
                                        {d.roiPct.toFixed(2)}%
                                      </div>
                                      <div
                                        style={{color: '#a1a1aa', fontSize: 10}}
                                      >
                                        累计收益率
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div
                                        style={{
                                          color: '#e4e4e7',
                                          marginBottom: 2
                                        }}
                                      >
                                        最高 {full(d.highVal)}
                                      </div>
                                      <div
                                        style={{
                                          color: '#e4e4e7',
                                          marginBottom: 2
                                        }}
                                      >
                                        最低 {full(d.lowVal)}
                                      </div>
                                      <div
                                        style={{
                                          color: '#60a5fa',
                                          fontWeight: 700,
                                          fontSize: 13,
                                          marginBottom: 2
                                        }}
                                      >
                                        ● 实际 {full(d.closeVal)}
                                      </div>
                                      <div
                                        style={{
                                          color:
                                            d.pnl >= 0 ? '#4ade80' : '#f87171'
                                        }}
                                      >
                                        收益 {d.pnl >= 0 ? '+' : ''}
                                        {full(Math.abs(d.pnl))}
                                      </div>
                                    </>
                                  )}
                                </div>
                              )
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey={chartMode === 'roi' ? 'roiPct' : 'value'}
                            stroke={chartMode === 'roi' ? '#4ade80' : '#3b82f6'}
                            strokeWidth={2}
                            fill="url(#colorChart)"
                            dot={false}
                            activeDot={{r: 4}}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-center py-16 text-sm text-gray-600">
                      {chartData.length === 0 ? '暂无走势数据' : '数据不足'}
                    </div>
                  )}
                </div>

                {/* 饼图 */}
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                  <h2 className="text-sm font-medium mb-3">资产占比</h2>
                  {pieData.length > 0 ? (
                    <div className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={75}
                            dataKey="value"
                            stroke="#18181b"
                            strokeWidth={2}
                          >
                            {pieData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#18181b',
                              border: '1px solid #27272a',
                              borderRadius: '8px',
                              fontSize: '12px'
                            }}
                            formatter={(value: number) => [
                              fmtFull(value, currency),
                              ''
                            ]}
                          />
                          <Legend wrapperStyle={{fontSize: '11px'}} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-center py-16 text-sm text-gray-600">
                      暂无数据
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {!loading && keyIds.length === 0 && (
            <div className="text-center py-20 text-sm text-gray-500">
              <Wallet className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="mb-1">暂无资产数据</p>
              <p className="text-xs text-gray-600">
                请先绑定 Binance API Key 并等待首次采集
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
