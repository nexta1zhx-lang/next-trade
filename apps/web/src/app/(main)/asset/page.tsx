'use client'

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'
import {
  Wallet,
  TrendingUp,
  Activity,
  AlertCircle,
  Eye,
  EyeOff,
  CalendarRange
} from 'lucide-react'
import {authHeaders, API_ORIGIN, getToken} from '@/lib/api'
import {api} from '@/lib/api'

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

// 隐私模式：金额打码
function fmtMask(
  n: number | null | undefined,
  privacy: boolean,
  currency = 'USD'
): string {
  if (privacy) return '****'
  if (n === null || n === undefined) return '--'
  return fmtFull(n, currency)
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

/** 小指标卡片 */
function EquityMiniCard({
  label,
  value,
  privacyMode,
  currency,
  isPnl,
  isPct,
  isNegative,
  plain
}: {
  label: string
  value: number | null | undefined
  privacyMode: boolean
  currency: string
  isPnl?: boolean
  isPct?: boolean
  isNegative?: boolean
  plain?: boolean
}) {
  const numVal = value ?? 0
  const color =
    isNegative && numVal < 0
      ? ''
      : isNegative
        ? 'text-red-400'
        : isPnl
          ? numVal >= 0
            ? 'text-emerald-500'
            : 'text-red-500'
          : isPct
            ? numVal >= 0
              ? 'text-emerald-500'
              : 'text-red-500'
            : ''
  const display = privacyMode
    ? '****'
    : plain
      ? String(numVal)
      : isPct
        ? `${numVal >= 0 ? '+' : ''}${numVal.toFixed(2)}%`
        : fmtFull(numVal, currency)
  return (
    <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${color}`}>{display}</p>
    </div>
  )
}

/** 区间分析行组件 */
function AnalysisRow({
  label,
  value,
  privacyMode,
  currency,
  isPnl,
  isPct,
  isNegative,
  suffix
}: {
  label: string
  value: number | null | undefined
  privacyMode: boolean
  currency: string
  isPnl?: boolean
  isPct?: boolean
  isNegative?: boolean
  suffix?: string
}) {
  const numVal = value ?? 0
  const color = isPnl
    ? numVal >= 0
      ? 'text-emerald-500'
      : 'text-red-500'
    : isPct
      ? numVal >= 0
        ? 'text-emerald-500'
        : 'text-red-500'
      : ''
  const display = privacyMode
    ? '****'
    : isPct
      ? `${numVal >= 0 ? '+' : ''}${numVal.toFixed(2)}%${suffix ?? ''}`
      : fmtFull(numVal, currency) + (suffix ?? '')
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium tabular-nums ${color}`}>
        {display}
      </span>
    </div>
  )
}

export default function AssetPage() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [initDone, setInitDone] = useState(false)
  const [currentAssets, setCurrentAssets] = useState<Record<
    number,
    any
  > | null>(null)
  const [todayData, setTodayData] = useState<any[]>([])
  const [ohlcData, setOhlcData] = useState<any[]>([])
  const [keyIds, setKeyIds] = useState<number[]>([])
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [timeRange, setTimeRange] = useState<TimeRange>('1d')
  const [chartMode, setChartMode] = useState<'value' | 'roi'>('value')
  const [privacyMode, setPrivacyMode] = useState(false)
  const [customRange, setCustomRange] = useState<{
    start: string
    end: string
  } | null>(null)

  useEffect(() => {
    setLoggedIn(!!getToken())
    setInitDone(true)
  }, [])

  const days = RANGE_DAYS[timeRange]

  // 计算当前选中的起止日期
  const rangeDates = useMemo(() => {
    if (customRange) return customRange
    const end = new Date()
    const start = new Date()
    start.setUTCDate(start.getUTCDate() - days)
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10)
    }
  }, [customRange, days])

  // 用 ref 记住 keyIds，避免 setKeyIds 导致 useCallback 重建 → 无限请求
  const keyIdsRef = useRef(keyIds)
  keyIdsRef.current = keyIds

  const fetchAll = useCallback(async () => {
    if (!loggedIn) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      // 1. V2 权益摘要 — 获取所有 Key 的当前权益 + ROI 等
      // 注意: fetchApi 已解包 json.data，返回的是数据本身
      const sumData: Record<string, any> = (await api.getEquitySummary()) ?? {}

      let keys: number[] = Object.keys(sumData).map(Number).sort()
      setCurrentAssets(sumData)
      setKeyIds(keys)
      if (keys.length > 0 && selectedKeyId === null) setSelectedKeyId(keys[0])

      // 2. 确认当前选中的 Key
      const activeKeyId = selectedKeyId ?? keys[0] ?? keyIdsRef.current[0]
      if (!activeKeyId) {
        setLoading(false)
        return
      }

      // 3. 按时间范围按需请求
      const is1d = timeRange === '1d' && !customRange

      if (is1d) {
        const todayDataArr: Array<{time: string; value: number}> =
          (await api.getEquityToday(activeKeyId)) ?? []
        setTodayData(todayDataArr)
        setOhlcData([])
      } else {
        // "全部"时不传 days，后端返回全部数据
        const curveParams: any = {keyId: activeKeyId}
        if (timeRange !== 'all') curveParams.days = days
        const curveData: any[] = (await api.getEquityCurve(curveParams)) ?? []
        const sorted = (Array.isArray(curveData) ? curveData : []).sort(
          (a: any, b: any) => a.hour?.localeCompare(b.hour || b.date)
        )
        setOhlcData(sorted)
        setTodayData([])
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loggedIn, days, selectedKeyId, timeRange, customRange])

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [fetchAll])

  const currentKeyAsset = selectedKeyId ? currentAssets?.[selectedKeyId] : null
  const selectedToday = useMemo(() => {
    if (!todayData) return null
    // v2 equity/today 返回数组
    if (Array.isArray(todayData)) {
      return {extremes: null, intraday: todayData}
    }
    return null
  }, [todayData, selectedKeyId])
  const extremes: any = selectedToday?.extremes ?? null
  const intraday = selectedToday?.intraday ?? []

  // ─── 全 Key 汇总 ───
  const aggregatedSummary = useMemo(() => {
    if (!currentAssets || keyIds.length === 0)
      return {
        totalEquity: 0,
        totalPnl: 0,
        avgRoi: 0,
        maxDd: 0,
        baseEquity: 0,
        count: 0
      }
    let totalEquity = 0
    let totalPnl = 0
    let baseEquity = 0
    let maxDd = 0
    let count = 0
    for (const kid of keyIds) {
      const a = currentAssets[kid]
      if (!a?.baseline) continue
      totalEquity += a.currentEquity ?? 0
      totalPnl += a.cumulativePnl ?? 0
      baseEquity += a.baseline.baseEquity ?? 0
      maxDd = Math.max(maxDd, a.maxDrawdown ?? 0)
      count++
    }
    const avgRoi = baseEquity > 0 ? (totalPnl / baseEquity) * 100 : 0
    return {totalEquity, totalPnl, avgRoi, maxDd, baseEquity, count}
  }, [currentAssets, keyIds])

  const amplitude = extremes?.lowVal
    ? ((extremes.highVal - extremes.lowVal) / extremes.lowVal) * 100
    : 0

  // ─── 较昨日对比 ───
  const yesterdayChange = useMemo(() => {
    if (ohlcData.length < 2) return null
    const yesterday = ohlcData[ohlcData.length - 2]
    const current = aggregatedSummary.totalEquity
    const diff = current - yesterday.closeVal
    const pct = yesterday.closeVal > 0 ? (diff / yesterday.closeVal) * 100 : 0
    return {diff, pct}
  }, [ohlcData, currentKeyAsset])

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
    <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-3 sm:py-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 mb-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <Wallet className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-base sm:text-lg font-bold">资产分析</h1>
        </div>
        <div className="flex items-center gap-1 bg-[#18181b] border border-gray-800 rounded-lg p-0.5 overflow-x-auto max-w-full">
          <button
            onClick={() => setPrivacyMode(!privacyMode)}
            className={`px-2 py-1.5 rounded-md transition-colors shrink-0 ${privacyMode ? 'bg-amber-500/15 text-amber-400' : 'text-gray-500 hover:text-gray-300'}`}
            title={privacyMode ? '显示金额' : '隐藏金额'}
          >
            {privacyMode ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </button>
          {Object.keys(FX_RATES).map(code => (
            <button
              key={code}
              onClick={() => setCurrency(code)}
              className={`px-2 py-1.5 text-xs rounded-md transition-colors shrink-0 ${currency === code ? 'bg-primary/15 text-primary font-medium' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {code}
            </button>
          ))}
          <button
            onClick={() => {
              setLoading(true)
              fetchAll()
            }}
            className="px-2 py-1.5 text-xs rounded-md text-gray-400 hover:text-gray-200 transition-colors border-l border-gray-800 ml-1 pl-2 shrink-0"
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
          {aggregatedSummary.count > 0 && (
            <>
              {/* ═══ 顶部：全 Key 汇总指标（放在 Key 选择上方） ═══ */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">
                    总权益 ({currency})
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {fmtMask(
                      aggregatedSummary.totalEquity,
                      privacyMode,
                      currency
                    )}
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
                    {aggregatedSummary.count} 个 Key
                  </p>
                </div>

                <EquityMiniCard
                  label="累计盈亏"
                  value={aggregatedSummary.totalPnl}
                  privacyMode={privacyMode}
                  currency={currency}
                  isPnl
                />
                <EquityMiniCard
                  label="综合收益率"
                  value={aggregatedSummary.avgRoi}
                  privacyMode={privacyMode}
                  currency={currency}
                  isPct
                />
                <EquityMiniCard
                  label="最大回撤(全Key)"
                  value={aggregatedSummary.maxDd}
                  privacyMode={privacyMode}
                  currency={currency}
                  isPct
                  isNegative
                />
                <EquityMiniCard
                  label="基线权益"
                  value={aggregatedSummary.baseEquity}
                  privacyMode={privacyMode}
                  currency={currency}
                />
                <EquityMiniCard
                  label="实盘"
                  value={aggregatedSummary.count}
                  privacyMode={false}
                  currency={currency}
                  plain
                />
              </div>
            </>
          )}

          {/* Key 选择器（放在汇总卡片下方） */}
          {keyIds.length > 0 && (
            <div className="flex gap-2 mb-4 overflow-x-auto -mx-2 px-2 scrollbar-none pb-1">
              {keyIds.map(kid => {
                const label = currentAssets?.[kid]?.label || '实盘'
                return (
                  <button
                    key={kid}
                    onClick={() => setSelectedKeyId(kid)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors shrink-0 whitespace-nowrap ${selectedKeyId === kid ? 'bg-primary/15 text-primary font-medium border border-primary/30' : 'bg-[#18181b] border border-gray-800 text-gray-400 hover:text-gray-200'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          {aggregatedSummary.count === 0 && keyIds.length > 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl mb-6">
              <Wallet className="w-10 h-10 mb-3 opacity-30" />
              <p>已绑定 {keyIds.length} 个 Key</p>
              <p className="text-xs text-gray-600 mt-1">
                等待首次基线采集...（每 30 分钟自动采集）
              </p>
            </div>
          )}

          {aggregatedSummary.count > 0 && (
            <>
              {/* 极值信息 */}
              {extremes && (
                <div className="text-[10px] text-muted-foreground mb-3 px-1">
                  今日 O: {fmtMask(extremes.openVal, privacyMode, currency)} H:{' '}
                  <span className="text-emerald-500">
                    {fmtMask(extremes.highVal, privacyMode, currency)}
                  </span>{' '}
                  L:{' '}
                  <span className="text-red-500">
                    {fmtMask(extremes.lowVal, privacyMode, currency)}
                  </span>{' '}
                  C:{' '}
                  {fmtMask(
                    currentKeyAsset.currentEquity,
                    privacyMode,
                    currency
                  )}{' '}
                  振幅 {amplitude.toFixed(2)}%
                </div>
              )}

              {/* ═══ 走势图 + 分析 ═══ */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
                <div className="lg:col-span-3 bg-[#18181b] rounded-xl border border-gray-800 p-3 sm:p-4">
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
                    <div className="flex items-center gap-1 bg-[#18181b] border border-gray-800 rounded-lg p-0.5 overflow-x-auto">
                      {(Object.keys(RANGE_LABELS) as TimeRange[]).map(r => (
                        <button
                          key={r}
                          onClick={() => {
                            setTimeRange(r)
                            setCustomRange(null)
                          }}
                          className={`px-2 py-1 text-xs rounded-md transition-colors shrink-0 ${timeRange === r && !customRange ? 'bg-primary/15 text-primary font-medium' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                          {RANGE_LABELS[r]}
                        </button>
                      ))}
                      {customRange ? (
                        <>
                          <input
                            type="date"
                            value={customRange.start}
                            onChange={e => {
                              setCustomRange({
                                ...customRange,
                                start: e.target.value
                              })
                              setLoading(true)
                            }}
                            className="w-20 px-1 py-1 text-[10px] bg-transparent border border-gray-700 rounded text-gray-300 focus:outline-none focus:border-primary/50"
                          />
                          <span className="text-[10px] text-gray-600">~</span>
                          <input
                            type="date"
                            value={customRange.end}
                            onChange={e => {
                              setCustomRange({
                                ...customRange,
                                end: e.target.value
                              })
                              setLoading(true)
                            }}
                            className="w-20 px-1 py-1 text-[10px] bg-transparent border border-gray-700 rounded text-gray-300 focus:outline-none focus:border-primary/50"
                          />
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            const end = new Date().toISOString().slice(0, 10)
                            const start = new Date(Date.now() - 30 * 86400000)
                              .toISOString()
                              .slice(0, 10)
                            setCustomRange({start, end})
                            setLoading(true)
                          }}
                          className="px-2 py-1 text-xs rounded-md text-gray-500 hover:text-gray-300 transition-colors"
                          title="自定义日期范围"
                        >
                          <CalendarRange className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {chartData.length > 1 ? (
                    <div className="h-[220px] sm:h-[280px] lg:h-[320px]">
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

                {/* 资金分析 — 当前 Key 一行行展示 */}
                <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-medium">资金分析</h2>
                    <span className="text-[10px] text-muted-foreground">
                      {currentKeyAsset?.label || '实盘'}
                    </span>
                  </div>
                  {currentKeyAsset?.baseline ? (
                    <div className="space-y-2">
                      <AnalysisRow
                        label="基线权益"
                        value={currentKeyAsset.baseline.baseEquity}
                        privacyMode={privacyMode}
                        currency={currency}
                      />
                      <AnalysisRow
                        label="当前权益"
                        value={currentKeyAsset.currentEquity}
                        privacyMode={privacyMode}
                        currency={currency}
                      />
                      <AnalysisRow
                        label="累计盈亏"
                        value={currentKeyAsset.cumulativePnl}
                        privacyMode={privacyMode}
                        currency={currency}
                        isPnl
                      />
                      <AnalysisRow
                        label="简单收益率"
                        value={currentKeyAsset.simpleRoi}
                        privacyMode={privacyMode}
                        currency={currency}
                        isPct
                      />
                      <AnalysisRow
                        label="时间加权 ROI"
                        value={currentKeyAsset.twRoi}
                        privacyMode={privacyMode}
                        currency={currency}
                        isPct
                      />
                      <AnalysisRow
                        label="最大回撤"
                        value={currentKeyAsset.maxDrawdown}
                        privacyMode={privacyMode}
                        currency={currency}
                        isPct
                        isNegative
                      />
                      {currentKeyAsset.dailyExtremes && (
                        <>
                          <div className="border-t border-gray-800 my-2" />
                          <AnalysisRow
                            label="今日最高"
                            value={currentKeyAsset.dailyExtremes.highVal}
                            privacyMode={privacyMode}
                            currency={currency}
                          />
                          <AnalysisRow
                            label="今日最低"
                            value={currentKeyAsset.dailyExtremes.lowVal}
                            privacyMode={privacyMode}
                            currency={currency}
                          />
                        </>
                      )}
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
