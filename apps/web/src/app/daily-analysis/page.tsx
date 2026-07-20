'use client'

import {useCallback, useState} from 'react'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Crosshair,
  Search,
  Loader2,
  AlertCircle
} from 'lucide-react'
import type {DailyAnalysisResult, DailyAnalysisItem} from '@nexttrade/shared'

// ─── 昨日 UTC 日期 ───
function yesterdayUTC(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ─── Tab 配置 ───
type TabId = 'amplitude' | 'gain' | 'loss' | 'doji'
interface TabDef {
  id: TabId
  label: string
  icon: typeof Activity
  color: string
}

const TABS: TabDef[] = [
  {id: 'amplitude', label: '振幅榜', icon: Activity, color: 'text-blue-400'},
  {id: 'gain', label: '涨幅榜', icon: TrendingUp, color: 'text-emerald-400'},
  {id: 'loss', label: '跌幅榜', icon: TrendingDown, color: 'text-red-400'},
  {id: 'doji', label: '十字星榜', icon: Crosshair, color: 'text-yellow-400'}
]

// ─── 格式化 ───
function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals)
}

function fmtVolume(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return fmt(n, 0)
}

// ─── 颜色辅助 ───
function changeColor(v: number): string {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-gray-400'
}

function changeBg(v: number): string {
  if (v > 0) return 'bg-emerald-500/10'
  if (v < 0) return 'bg-red-500/10'
  return 'bg-gray-500/10'
}

// ─── 子组件: 排行榜表格 ───
function RankTable({
  items,
  label,
  color
}: {
  items: DailyAnalysisItem[]
  label: string
  color: string
}) {
  if (items.length === 0) {
    return <div className="text-center text-gray-500 py-12">暂无数据</div>
  }

  return (
    <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
      <table className="w-full text-sm min-w-[600px] md:min-w-0">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left py-3 px-2 w-10">#</th>
            <th className="text-left py-3 px-2">币种</th>
            <th className="text-right py-3 px-2">开盘</th>
            <th className="text-right py-3 px-2">最高</th>
            <th className="text-right py-3 px-2">最低</th>
            <th className="text-right py-3 px-2">收盘</th>
            <th className={`text-right py-3 px-2 ${color}`}>
              {label === '振幅榜'
                ? '振幅 %'
                : label === '涨幅榜'
                  ? '涨幅 %'
                  : label === '跌幅榜'
                    ? '跌幅 %'
                    : '振幅 %'}
            </th>
            <th className="text-right py-3 px-2">
              {label === '十字星榜' ? '涨跌幅 %' : '涨跌幅 %'}
            </th>
            <th className="text-right py-3 px-2 text-gray-400">成交额</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 10).map((item, i) => (
            <tr
              key={item.symbol}
              className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
            >
              <td className="py-2.5 px-2 text-gray-500">{i + 1}</td>
              <td className="py-2.5 px-2 font-medium">{item.base}</td>
              <td className="py-2.5 px-2 text-right text-gray-300">
                {fmt(item.open)}
              </td>
              <td className="py-2.5 px-2 text-right text-emerald-400">
                {fmt(item.high)}
              </td>
              <td className="py-2.5 px-2 text-right text-red-400">
                {fmt(item.low)}
              </td>
              <td className="py-2.5 px-2 text-right text-gray-300">
                {fmt(item.close)}
              </td>
              <td
                className={`py-2.5 px-2 text-right font-mono font-semibold ${changeColor(item.change)}`}
              >
                {label === '振幅榜' || label === '十字星榜'
                  ? `${fmt(item.amplitude)}%`
                  : `${item.change >= 0 ? '+' : ''}${fmt(item.change)}%`}
              </td>
              <td
                className={`py-2.5 px-2 text-right font-mono ${changeColor(item.change)}`}
              >
                {item.change >= 0 ? '+' : ''}
                {fmt(item.change)}%
              </td>
              <td className="py-2.5 px-2 text-right text-gray-400">
                {fmtVolume(item.quoteVolume)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── 主页面 ───
export default function DailyAnalysisPage() {
  const [date, setDate] = useState(yesterdayUTC())
  const [minVolume, setMinVolume] = useState(1_000_000)
  const [data, setData] = useState<DailyAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('amplitude')

  const fetchAnalysis = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const base =
        window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''
      const res = await fetch(
        `${base}/api/daily-analysis?date=${date}&minQuoteVolume=${minVolume}`
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Request failed')
      setData(json.data as DailyAnalysisResult)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [date, minVolume])

  // 当前 Tab 数据
  const currentItems: DailyAnalysisItem[] = (() => {
    if (!data) return []
    switch (activeTab) {
      case 'amplitude':
        return data.rankAmplitude
      case 'gain':
        return data.rankGain
      case 'loss':
        return data.rankLoss
      case 'doji':
        return data.rankDoji
    }
  })()

  const currentTab = TABS.find(t => t.id === activeTab)!

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* ─── 控制面板 ─── */}
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-5 mb-6">
        <div className="flex flex-wrap items-end gap-6">
          {/* 日期选择 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
              日期 (UTC)
            </label>
            <input
              type="date"
              value={date}
              max={yesterdayUTC()}
              onChange={e => setDate(e.target.value)}
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200
                           focus:outline-none focus:border-blue-500 transition-colors
                           [color-scheme:dark]"
            />
          </div>

          {/* 成交额阈值滑块 */}
          <div className="flex-1 min-w-[200px] flex flex-col gap-1.5">
            <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
              最低成交额:{' '}
              <span className="text-blue-400 font-mono">
                ${fmtVolume(minVolume)}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={50_000_000}
              step={500_000}
              value={minVolume}
              onChange={e => setMinVolume(Number(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer
                           accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-600">
              <span>$0</span>
              <span>$50M</span>
            </div>
          </div>

          {/* 查询按钮 */}
          <button
            onClick={fetchAnalysis}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800
                         text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {loading ? '查询中...' : '查询分析'}
          </button>
        </div>
      </div>

      {/* ─── 错误提示 ─── */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-3 mb-6 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ─── 结果区域 ─── */}
      {data && (
        <>
          {/* 摘要 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-xs text-muted-foreground">
            <span>📅 {data.date}</span>
            <span>
              📊 市场总数:{' '}
              <span className="text-foreground">{data.totalSymbols}</span>
            </span>
            <span>
              🔍 筛选后:{' '}
              <span className="text-foreground">{data.filteredCount}</span>
            </span>
          </div>

          {/* ─── Tabs ─── */}
          <div className="flex gap-1 mb-4 bg-[#18181b] rounded-xl border border-gray-800 p-1 overflow-x-auto">
            {TABS.map(tab => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                      ${active ? 'bg-gray-700 text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  <tab.icon className={`w-4 h-4 ${active ? tab.color : ''}`} />
                  {tab.label}
                  {tab.id === 'doji' && data.rankDoji.length > 0 && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                      {data.rankDoji.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ─── 表格 ─── */}
          <div className="bg-[#18181b] rounded-xl border border-gray-800 overflow-hidden">
            <RankTable
              items={currentItems}
              label={currentTab.label}
              color={currentTab.color}
            />
          </div>

          {/* 数据脚注 */}
          <p className="mt-3 text-xs text-gray-600">
            数据来源: Binance USDT 永续合约 · 缓存 1 小时
            {data.cachedAt &&
              ` · 缓存时间: ${new Date(data.cachedAt).toLocaleString('zh-CN', {timeZone: 'UTC'})} UTC`}
          </p>
        </>
      )}

      {/* ─── 初始空状态 ─── */}
      {!data && !loading && !error && (
        <div className="text-center py-24 text-gray-500">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg mb-1">选择日期后点击「查询分析」</p>
          <p className="text-sm">
            系统将抓取 Binance USDT 永续合约市场数据并计算排行
          </p>
        </div>
      )}
    </div>
  )
}
