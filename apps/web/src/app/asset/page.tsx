'use client'

import {useCallback, useEffect, useMemo, useState} from 'react'
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
  Landmark,
  BarChart3,
  PiggyBank,
  HandCoins,
  AlertCircle,
  History
} from 'lucide-react'
import {authHeaders, API_ORIGIN, getToken} from '@/lib/api'
import type {AssetOverview} from '@nexttrade/shared'

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

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}

function fmtFull(n: number): string {
  if (!Number.isFinite(n) || Number.isNaN(n)) return '0.00'
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

export default function AssetPage() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [keys, setKeys] = useState<KeySnapshots[]>([])
  const [overviews, setOverviews] = useState<AssetOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)

  // ─── 同步登录状态（避免 hydration 不匹配） ───
  useEffect(() => {
    setLoggedIn(!!getToken())
  }, [])

  // ─── 获取数据 ───
  const fetchData = useCallback(async () => {
    if (!loggedIn) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [snapRes, ovRes] = await Promise.all([
        fetch(`${API_ORIGIN}/api/asset/snapshots?days=90`, {
          headers: authHeaders()
        }),
        fetch(`${API_ORIGIN}/api/asset/overview`, {
          headers: authHeaders()
        })
      ])
      const snapJson = await snapRes.json()
      const ovJson = await ovRes.json()

      if (snapJson.success) {
        const data = Array.isArray(snapJson.data)
          ? snapJson.data
          : [snapJson.data]
        setKeys(data)
        if (data.length > 0 && !selectedKeyId) {
          setSelectedKeyId(data[0].keyId)
        }
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
  }, [loggedIn, selectedKeyId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ─── 历史数据同步 ───
  const handleSync = useCallback(async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch(`${API_ORIGIN}/api/asset/sync`, {
        method: 'POST',
        headers: authHeaders()
      })
      const json = await res.json()
      if (json.success) {
        const total = json.data.reduce(
          (s: number, r: any) => s + r.snapshots,
          0
        )
        setSyncMsg(`获取 ${total} 天历史快照完成`)
        fetchData()
      } else {
        setSyncMsg(`同步失败: ${json.error}`)
      }
    } catch (e) {
      setSyncMsg(`同步失败: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(null), 8000)
    }
  }, [fetchData])

  // ─── 当前选中的 Key 的数据 ───
  const currentKey = keys.find(k => k.keyId === selectedKeyId)
  const currentOverview = overviews.find(o => o.apiKeyId === selectedKeyId)

  // ─── 最近的资产变化计算 ───
  const changeInfo = useMemo(() => {
    if (!currentKey || currentKey.snapshots.length < 2) return null
    const sorted = [...currentKey.snapshots].sort((a, b) =>
      a.snapDate.localeCompare(b.snapDate)
    )
    const latest = sorted[sorted.length - 1]
    const prev = sorted[sorted.length - 2]
    const diff = latest.totalEquity - prev.totalEquity
    const pct = prev.totalEquity > 0 ? (diff / prev.totalEquity) * 100 : 0
    return {diff, pct}
  }, [currentKey])

  // ─── 模块分布数据 ───
  const moduleData = useMemo(() => {
    if (!currentOverview) return []
    const items = [
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
    ]
    return items.filter(i => i.value > 0)
  }, [currentOverview])

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* ─── 标题栏 ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Wallet className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">资产概况</h1>
        </div>
        <div className="flex items-center gap-2">
          {keys.length > 0 && !syncing && (
            <button
              onClick={handleSync}
              className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5
                         text-xs text-amber-400 hover:bg-amber-500/20 transition-colors"
              title="拉取币安 SAPI 最近 30 天历史资产快照"
            >
              <History className="w-3.5 h-3.5" />
              同步历史
            </button>
          )}
          {syncing && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              同步中...
            </span>
          )}
          {syncMsg && (
            <span className="text-xs text-emerald-400">{syncMsg}</span>
          )}
        </div>
      </div>

      {!loggedIn && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-3 text-sm text-amber-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          请先登录以查看资产数据
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
          {/* ─── Key 切换 ─── */}
          {keys.length > 1 && (
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

          {/* ─── 总权益卡片 ─── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4 md:col-span-2">
              <p className="text-xs text-muted-foreground mb-1">
                总权益 (USDT)
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {currentOverview ? fmtFull(currentOverview.totalEquity) : '--'}
              </p>
              {changeInfo && (
                <p
                  className={`text-xs mt-1 ${changeInfo.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {changeInfo.diff >= 0 ? '+' : ''}
                  {fmtFull(changeInfo.diff)} ({changeInfo.pct >= 0 ? '+' : ''}
                  {changeInfo.pct.toFixed(2)}%) 较前一日
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
                <p className="text-lg font-bold tabular-nums">{fmt(m.value)}</p>
              </div>
            ))}
          </div>

          {/* ─── 资产曲线图 ─── */}
          <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4 mb-6">
            <h2 className="text-sm font-medium mb-4">资产曲线</h2>
            {currentKey && currentKey.snapshots.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={[...currentKey.snapshots].sort((a, b) =>
                      a.snapDate.localeCompare(b.snapDate)
                    )}
                    margin={{top: 5, right: 10, left: 0, bottom: 5}}
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
                      tickFormatter={fmt}
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
                        fmtFull(value),
                        '总权益 (USDT)'
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalEquity"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#colorEquity)"
                      dot={false}
                      activeDot={{r: 4, fill: '#3b82f6'}}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-12 text-sm text-gray-600">
                {currentKey
                  ? '暂无资产快照数据，等待定时任务 UTC 00:10 自动采集'
                  : '请先绑定 Binance API Key'}
              </div>
            )}
          </div>

          {/* ─── 各 Key 快照列表 ─── */}
          {keys.length > 0 && (
            <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
              <h2 className="text-sm font-medium mb-3">快照记录</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800/50">
                      <th className="text-left py-2 pr-3 font-medium">Key</th>
                      <th className="text-left py-2 pr-3 font-medium">日期</th>
                      <th className="text-right py-2 pr-3 font-medium">
                        总权益
                      </th>
                      <th className="text-right py-2 pr-3 font-medium">现货</th>
                      <th className="text-right py-2 pr-3 font-medium">合约</th>
                      <th className="text-right py-2 pr-3 font-medium">资金</th>
                      <th className="text-right py-2 pr-3 font-medium">理财</th>
                      <th className="text-right py-2 font-medium">杠杆</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map(k =>
                      [...k.snapshots]
                        .sort((a, b) => b.snapDate.localeCompare(a.snapDate))
                        .slice(0, 10)
                        .map(s => (
                          <tr
                            key={`${k.keyId}-${s.snapDate}`}
                            className="border-b border-gray-800/30 hover:bg-gray-800/20"
                          >
                            <td className="py-2 pr-3 text-gray-400">
                              {k.label}
                            </td>
                            <td className="py-2 pr-3">{s.snapDate}</td>
                            <td className="py-2 pr-3 text-right font-medium tabular-nums">
                              {fmtFull(s.totalEquity)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-gray-400">
                              {fmt(s.spotValue)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-gray-400">
                              {fmt(s.contractEquity)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-gray-400">
                              {fmt(s.fundingValue)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-gray-400">
                              {fmt(s.earnValue)}
                            </td>
                            <td className="py-2 text-right tabular-nums text-gray-400">
                              {fmt(s.marginEquity)}
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && loggedIn && keys.length === 0 && (
        <div className="text-center py-20 text-sm text-gray-500">
          <Wallet className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="mb-1">暂无资产数据</p>
          <p className="text-xs text-gray-600">
            请先在「API 密钥」页面绑定 Binance Key，等待定时任务 UTC 00:10
            自动采集
          </p>
        </div>
      )}
    </div>
  )
}
