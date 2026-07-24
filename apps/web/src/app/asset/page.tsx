'use client'

import {useCallback, useEffect, useMemo, useState, useRef} from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot
} from 'recharts'
import {
  Wallet,
  TrendingUp,
  Landmark,
  PiggyBank,
  HandCoins,
  AlertCircle
} from 'lucide-react'
import {authHeaders, API_ORIGIN, getToken} from '@/lib/api'
import type {AssetOverview} from '@nexttrade/shared'
import {useUserConfig} from '@/hooks/useUserConfig'

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

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

type DateRange = '1d' | '1w' | '1m' | '3m' | '1y'
const DATE_RANGE_DAYS: Record<DateRange, number> = {
  '1d': 1,
  '1w': 7,
  '1m': 30,
  '3m': 90,
  '1y': 365
}
const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '1d': '1天',
  '1w': '周',
  '1m': '月',
  '3m': '3月',
  '1y': '年'
}

interface SnapData {
  snapDate: string
  totalEquity: number
  spotValue: number
  contractEquity: number
  fundingValue: number
  earnValue: number
  marginEquity: number
}
interface KeySnapshots {
  keyId: number
  label: string
  snapshots: SnapData[]
}

export default function AssetPage() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [keys, setKeys] = useState<KeySnapshots[]>([])
  const [overviews, setOverviews] = useState<AssetOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>('3m')
  const syncTriggered = useRef(false)

  const userConfig = useUserConfig()
  const [currency, setCurrency] = useState(
    (userConfig.currency as string) ?? 'USD'
  )
  const assetAutoSync = userConfig.assetAutoSync ?? 1

  useEffect(() => {
    setCurrency((userConfig.currency as string) ?? 'USD')
  }, [userConfig.currency])

  useEffect(() => {
    setLoggedIn(!!getToken())
  }, [])

  const fetchData = useCallback(async () => {
    if (!loggedIn) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const days = DATE_RANGE_DAYS[dateRange]
      const incRec = assetAutoSync ? 'true' : 'false'
      const [snapRes, ovRes] = await Promise.all([
        fetch(
          `${API_ORIGIN}/api/asset/snapshots?days=${days}&includeReconstructed=${incRec}`,
          {
            headers: authHeaders()
          }
        ),
        fetch(`${API_ORIGIN}/api/asset/overview`, {headers: authHeaders()})
      ])
      const snapJson = await snapRes.json()
      const ovJson = await ovRes.json()
      if (snapJson.success) {
        const data = Array.isArray(snapJson.data)
          ? snapJson.data
          : [snapJson.data]
        setKeys(data)
        if (data.length > 0 && !selectedKeyId) setSelectedKeyId(data[0].keyId)
      }
      if (ovJson.success) {
        const data = Array.isArray(ovJson.data)
          ? ovJson.data
          : ovJson.data
            ? [ovJson.data]
            : []
        setOverviews(data)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loggedIn, selectedKeyId, dateRange])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 自动同步（首次使用无数据时触发）
  const today = new Date().toISOString().slice(0, 10)
  useEffect(() => {
    if (!loggedIn || syncTriggered.current || !assetAutoSync || loading) return
    // 检查今天是否有快照
    const hasToday = keys.some(k => k.snapshots.some(s => s.snapDate === today))
    if (!hasToday && keys.length > 0) {
      syncTriggered.current = true
      fetch(`${API_ORIGIN}/api/asset/sync`, {
        method: 'POST',
        headers: authHeaders()
      })
        .then(r => r.json())
        .then(r => {
          if (r.success) fetchData()
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, loading, assetAutoSync])

  const currentKey = keys.find(k => k.keyId === selectedKeyId)
  const currentOverview = overviews.find(o => o.apiKeyId === selectedKeyId)

  const changeInfo = useMemo(() => {
    if (!currentKey || currentKey.snapshots.length < 2) return null
    const sorted = [...currentKey.snapshots].sort((a, b) =>
      a.snapDate.localeCompare(b.snapDate)
    )
    const latest = sorted[sorted.length - 1],
      prev = sorted[sorted.length - 2]
    const diff = latest.totalEquity - prev.totalEquity
    return {
      diff,
      pct: prev.totalEquity > 0 ? (diff / prev.totalEquity) * 100 : 0
    }
  }, [currentKey])

  const moduleData = useMemo(() => {
    if (!currentOverview) return []
    return [
      {
        name: '现货',
        value: currentOverview.spotValue,
        icon: Wallet,
        color: '#3b82f6'
      },
      {
        name: '合约',
        value: currentOverview.contractEquity,
        icon: TrendingUp,
        color: '#8b5cf6'
      },
      {
        name: '资金',
        value: currentOverview.fundingValue,
        icon: Landmark,
        color: '#10b981'
      },
      {
        name: '理财',
        value: currentOverview.earnValue,
        icon: PiggyBank,
        color: '#f59e0b'
      },
      {
        name: '杠杆',
        value: currentOverview.marginEquity,
        icon: HandCoins,
        color: '#ef4444'
      }
    ].filter(i => i.value > 0)
  }, [currentOverview])

  const chartData = useMemo(() => {
    if (!currentKey) return []
    const rate = FX_RATES[currency] ?? 1
    return [...currentKey.snapshots]
      .sort((a, b) => a.snapDate.localeCompare(b.snapDate))
      .map(s => ({...s, displayValue: s.totalEquity * rate}))
  }, [currentKey, currency])

  const extremes = useMemo(() => {
    if (chartData.length === 0) return null
    let max = chartData[0],
      min = chartData[0]
    for (const d of chartData) {
      if (d.displayValue > max.displayValue) max = d
      if (d.displayValue < min.displayValue) min = d
    }
    return {max, min: min !== max ? min : null}
  }, [chartData])

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Wallet className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">资产概况</h1>
        </div>
        <div className="flex items-center gap-1 bg-[#18181b] border border-gray-800 rounded-lg p-0.5">
          {Object.keys(FX_RATES).map(code => (
            <button
              key={code}
              onClick={() => {
                setCurrency(code)
                fetch(`${API_ORIGIN}/api/user/config`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders()
                  },
                  body: JSON.stringify({currency: code})
                }).catch(() => {})
              }}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                currency === code
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4 bg-[#18181b] border border-gray-800 rounded-lg p-0.5 w-fit">
        {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map(key => (
          <button
            key={key}
            onClick={() => setDateRange(key)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              dateRange === key
                ? 'bg-primary/15 text-primary font-medium'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {DATE_RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      {keys.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {keys.map(k => (
            <button
              key={k.keyId}
              onClick={() => setSelectedKeyId(k.keyId)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                selectedKeyId === k.keyId
                  ? 'bg-primary/15 text-primary font-medium border border-primary/30'
                  : 'bg-[#18181b] border border-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {!loggedIn && (
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4 md:col-span-2">
              <p className="text-xs text-muted-foreground mb-1">
                总权益 ({currency})
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {currentOverview
                  ? fmtFull(currentOverview.totalEquity, currency)
                  : '--'}
              </p>
              {changeInfo && (
                <p
                  className={`text-xs mt-1 ${changeInfo.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {changeInfo.diff >= 0 ? '+' : ''}
                  {fmtFull(changeInfo.diff, currency)} (
                  {changeInfo.pct >= 0 ? '+' : ''}
                  {changeInfo.pct.toFixed(2)}%)
                </p>
              )}
              {currentOverview && (
                <p className="text-[10px] text-gray-600 mt-1">
                  更新于 {currentOverview.snapDate}
                </p>
              )}
            </div>
            {moduleData.map(m => (
              <div
                key={m.name}
                className="bg-[#18181b] rounded-xl border border-gray-800 p-4"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <m.icon className="w-3.5 h-3.5" style={{color: m.color}} />
                  <p className="text-xs text-muted-foreground">{m.name}</p>
                </div>
                <p className="text-lg font-bold tabular-nums">
                  {fmt(m.value, currency)}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
            <h2 className="text-sm font-medium mb-4">资产曲线 ({currency})</h2>
            {chartData.length > 1 ? (
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{top: 20, right: 10, left: 0, bottom: 5}}
                  >
                    <defs>
                      <linearGradient
                        id="colorEquity"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#3b82f6"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#3b82f6"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis
                      dataKey="snapDate"
                      tickFormatter={fmtDate}
                      tick={{fontSize: 11, fill: '#71717a'}}
                      axisLine={{stroke: '#27272a'}}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={v =>
                        fmt(v / (FX_RATES[currency] ?? 1), currency)
                      }
                      tick={{fontSize: 11, fill: '#71717a'}}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#18181b',
                        border: '1px solid #27272a',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                      labelFormatter={fmtDate}
                      formatter={(value: number) => [
                        fmtFull(value / (FX_RATES[currency] ?? 1), currency),
                        `总权益 (${currency})`
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="displayValue"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#colorEquity)"
                      dot={false}
                      activeDot={{r: 4, fill: '#3b82f6'}}
                    />
                    {extremes?.max && (
                      <ReferenceDot
                        x={extremes.max.snapDate}
                        y={extremes.max.displayValue}
                        r={5}
                        fill="#22c55e"
                        stroke="#18181b"
                        strokeWidth={2}
                        label={{
                          value: `▲ ${fmtFull(extremes.max.totalEquity, currency)}`,
                          position: 'top',
                          fontSize: 10,
                          fill: '#22c55e'
                        }}
                      />
                    )}
                    {extremes?.min && (
                      <ReferenceDot
                        x={extremes.min.snapDate}
                        y={extremes.min.displayValue}
                        r={5}
                        fill="#ef4444"
                        stroke="#18181b"
                        strokeWidth={2}
                        label={{
                          value: `▼ ${fmtFull(extremes.min.totalEquity, currency)}`,
                          position: 'bottom',
                          fontSize: 10,
                          fill: '#ef4444'
                        }}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-12 text-sm text-gray-600">
                {keys.length > 0
                  ? '暂无资产快照数据'
                  : '请先绑定 Binance API Key'}
              </div>
            )}
          </div>
        </>
      )}

      {!loading && loggedIn && keys.length === 0 && (
        <div className="text-center py-20 text-sm text-gray-500">
          <Wallet className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="mb-1">暂无资产数据</p>
          <p className="text-xs text-gray-600">请先绑定 Binance API Key</p>
        </div>
      )}
    </div>
  )
}
