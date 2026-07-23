'use client'

import {useCallback, useState, useEffect, useMemo} from 'react'
import {Activity, Crosshair, AlertCircle, ArrowUpDown} from 'lucide-react'
import type {DailyAnalysisResult, DailyAnalysisItem} from '@nexttrade/shared'
import dynamic from 'next/dynamic'

const SymbolDetail = dynamic(() => import('./SymbolDetail'), {ssr: false})

function yesterdayUTC(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

type SortKey = 'amplitude' | 'change' | 'quoteVolume'

function fmt(n: number, d = 2): string {
  return n.toFixed(d)
}
function fmtVol(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return fmt(n, 0)
}

const MIN_VOLUME = 20_000_000

export default function DailyAnalysisPage() {
  const [date, setDate] = useState(yesterdayUTC())
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setClock(d.toLocaleTimeString('zh-CN', {hour12: false}))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])
  const [data, setData] = useState<DailyAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('change')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectedItem, setSelectedItem] = useState<DailyAnalysisItem | null>(
    null
  )

  const fetchAnalysis = useCallback(
    async (signal: AbortSignal, isRetry = false) => {
      setLoading(true)
      if (!isRetry) setError(null)
      try {
        const base =
          window.location.hostname === 'localhost'
            ? 'http://localhost:3001'
            : ''
        const res = await fetch(
          `${base}/api/daily-analysis?date=${date}&minQuoteVolume=${MIN_VOLUME}`,
          {signal}
        )
        const json = await res.json()
        if (!json.success) throw new Error(json.error ?? 'Request failed')
        if (!json.data && !isRetry) return fetchAnalysis(signal, true)
        setData(json.data as DailyAnalysisResult)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [date]
  )

  useEffect(() => {
    const c = new AbortController()
    fetchAnalysis(c.signal)
    return () => c.abort()
  }, [fetchAnalysis])

  const allItems = useMemo(() => {
    if (!data) return []
    return [...data.rankAmplitude].sort((a, b) => {
      const mul = sortAsc ? 1 : -1
      return (a[sortKey] - b[sortKey]) * mul
    })
  }, [data, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 h-screen flex flex-col overflow-hidden">
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3 sm:p-4 mb-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">日期</span>
            <input
              type="date"
              value={date}
              max={yesterdayUTC()}
              onChange={e => setDate(e.target.value)}
              className="bg-[#0a0a0b] border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500 transition-colors [color-scheme:dark] w-36"
            />
          </div>
          <span className="ml-auto flex items-center gap-3">
            {clock && (
              <span className="text-xs font-mono tabular-nums text-gray-400">
                {clock}
              </span>
            )}
            {loading && (
              <span className="flex items-center gap-1.5 text-xs text-primary">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                加载中
              </span>
            )}
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-3 mb-4 shrink-0 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col md:flex-row gap-4 flex-1 overflow-hidden">
          {/* 左栏 */}
          <div className="w-full md:w-[23%] shrink-0">
            <div className="bg-[#18181b] rounded-xl border border-gray-800 overflow-hidden h-full flex flex-col">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50 text-[10px] text-gray-600 uppercase tracking-wider shrink-0">
                <span className="w-5 shrink-0 text-center">#</span>
                <span className="flex-1 flex items-center gap-1">
                  <span>币种</span>
                  <button
                    onClick={() => toggleSort('quoteVolume')}
                    className={`flex items-center gap-0.5 hover:text-gray-400 transition-colors ${sortKey === 'quoteVolume' ? 'text-primary' : ''}`}
                  >
                    量 <ArrowUpDown className="w-2.5 h-2.5" />
                  </button>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => toggleSort('change')}
                    className={`flex items-center gap-0.5 hover:text-gray-400 transition-colors ${sortKey === 'change' ? 'text-primary' : ''}`}
                  >
                    涨跌 <ArrowUpDown className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => toggleSort('amplitude')}
                    className={`flex items-center gap-0.5 hover:text-gray-400 transition-colors ${sortKey === 'amplitude' ? 'text-primary' : ''}`}
                  >
                    振幅 <ArrowUpDown className="w-2.5 h-2.5" />
                  </button>
                </span>
              </div>
              <div
                className="flex-1 overflow-y-auto"
                style={{maxHeight: 'none'}}
              >
                {allItems.length === 0 ? (
                  <div className="text-center text-gray-500 py-12 text-xs">
                    暂无数据
                  </div>
                ) : (
                  allItems.slice(0, 100).map((item, i) => {
                    const sel = selectedItem?.symbol === item.symbol
                    return (
                      <div
                        key={item.symbol}
                        onClick={() => setSelectedItem(item)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b border-gray-800/30 cursor-pointer transition-colors ${
                          sel
                            ? 'bg-primary/10 border-l-2 border-l-primary'
                            : 'hover:bg-gray-800/30'
                        }`}
                      >
                        <span className="w-5 shrink-0 text-center text-gray-600">
                          {i + 1}
                        </span>
                        <span className="flex-1 flex flex-col min-w-0 leading-tight">
                          <span className="font-medium text-gray-200 truncate flex items-center gap-1">
                            {item.base}
                            {item.isDoji && (
                              <Crosshair className="w-2.5 h-2.5 text-yellow-400 shrink-0" />
                            )}
                          </span>
                          <span className="text-gray-500 truncate text-[10px]">
                            {fmtVol(item.quoteVolume)}
                          </span>
                        </span>
                        <span className="flex flex-col items-end leading-tight shrink-0">
                          <span
                            className={`font-medium ${item.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                          >
                            {item.change >= 0 ? '+' : ''}
                            {fmt(item.change)}%
                          </span>
                          <span className="text-gray-300 text-[10px]">
                            {fmt(item.amplitude)}%
                          </span>
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
              <div className="px-3 py-2 border-t border-gray-800/50 text-[10px] text-gray-600 flex gap-3 shrink-0">
                <span>共 {data.totalSymbols} 个</span>
                <span>筛选 {data.filteredCount} 个</span>
              </div>
            </div>
          </div>

          {/* 右栏 */}
          <div className="flex-1 min-w-0">
            {selectedItem ? (
              <SymbolDetail
                item={selectedItem}
                selectedDate={date}
                onClose={() => setSelectedItem(null)}
              />
            ) : (
              <div className="bg-[#18181b] rounded-xl border border-gray-800 flex items-center justify-center min-h-[300px]">
                <div className="text-center text-gray-600">
                  <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">点击左侧币种查看 K 线图与复盘</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="flex-1 flex items-center justify-center text-center text-gray-500">
          <div>
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg mb-1">选择日期自动加载</p>
            <p className="text-sm">
              切换日期将自动拉取 Binance USDT 永续合约数据
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
