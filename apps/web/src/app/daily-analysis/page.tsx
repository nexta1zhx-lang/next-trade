'use client'

import {useCallback, useState, useEffect, useMemo, useRef} from 'react'
import {
  Activity,
  Crosshair,
  AlertCircle,
  ArrowUpDown,
  Star,
  Search
} from 'lucide-react'
import type {DailyAnalysisResult, DailyAnalysisItem} from '@nexttrade/shared'
import type {FavoriteSymbol} from '@nexttrade/shared'
import dynamic from 'next/dynamic'
import {authHeaders, getToken} from '@/lib/api'
import {useUserConfig} from '@/hooks/useUserConfig'

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

/** SSE ticker 数据类型 */
interface TickerData {
  symbol: string
  price: string
  open: string
  change: string
  volume: string
  quoteVol: string
  high: string
  low: string
}

type AllSortKey = 'price' | 'change' | 'quoteVol' | 'base'

export default function DailyAnalysisPage() {
  const userConfig = useUserConfig()
  const minQuoteVolume = userConfig.minQuoteVolume || 20000000
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

  // ─── 搜索 & Tab ───
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'all' | 'fav'>('daily')

  // ─── 全部 Tab 排序 ───
  const [allSortKey, setAllSortKey] = useState<AllSortKey>('quoteVol')
  const [allSortAsc, setAllSortAsc] = useState(false)

  const toggleAllSort = (key: AllSortKey) => {
    if (allSortKey === key) setAllSortAsc(v => !v)
    else {
      setAllSortKey(key)
      setAllSortAsc(false)
    }
  }

  /** 计算振幅 (ticker high-low)/open */
  const calcAmplitude = (t: TickerData | undefined) => {
    if (!t) return 0
    const high = Number(t.high)
    const low = Number(t.low)
    const open = Number(t.open)
    return open > 0 ? ((high - low) / open) * 100 : 0
  }

  /** 将 BTC/USDT:USDT 转为 Binance ticker 格式 BTCUSDT */
  const toBinanceSymbol = (s: string) => s.replace('/USDT:USDT', 'USDT')

  // ─── 收藏 ───
  const [favorites, setFavorites] = useState<FavoriteSymbol[]>([])
  const [favLoading, setFavLoading] = useState(false)
  const loggedIn = typeof window !== 'undefined' && !!getToken()

  // ─── 实时 Ticker 数据（来自 SSE） ───
  const [tickerMap, setTickerMap] = useState<Record<string, TickerData>>({})
  const tickerMapRef = useRef(tickerMap)
  tickerMapRef.current = tickerMap

  // ─── SSE 连接 ───
  useEffect(() => {
    const base =
      window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''
    const es = new EventSource(`${base}/api/ticker/stream`)

    es.onmessage = (event: MessageEvent) => {
      try {
        const tickers: TickerData[] = JSON.parse(event.data)
        const map: Record<string, TickerData> = {}
        for (const t of tickers) {
          map[t.symbol] = t
        }
        setTickerMap(prev => ({...prev, ...map}))
      } catch {}
    }

    es.onerror = () => {
      // 自动重连
    }

    return () => es.close()
  }, [])

  // ─── 获取收藏列表 ───
  const fetchFavorites = useCallback(async () => {
    if (!loggedIn) {
      setFavorites([])
      return
    }
    setFavLoading(true)
    try {
      const base =
        window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''
      const res = await fetch(`${base}/api/favorites`, {
        headers: authHeaders()
      })
      const json = await res.json()
      if (json.success) setFavorites(json.data)
    } catch {
    } finally {
      setFavLoading(false)
    }
  }, [loggedIn])

  useEffect(() => {
    fetchFavorites()
  }, [fetchFavorites])

  // ─── 收藏操作 ───
  const favSymbolSet = useMemo(
    () => new Set(favorites.map(f => f.symbol)),
    [favorites]
  )

  const toggleFavorite = useCallback(
    async (item: DailyAnalysisItem) => {
      if (!loggedIn) return
      const base =
        window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''

      if (favSymbolSet.has(item.symbol)) {
        // 取消收藏
        await fetch(
          `${base}/api/favorites/${encodeURIComponent(item.symbol)}`,
          {method: 'DELETE', headers: authHeaders()}
        )
        setFavorites(prev => prev.filter(f => f.symbol !== item.symbol))
      } else {
        // 添加收藏
        const res = await fetch(`${base}/api/favorites`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', ...authHeaders()},
          body: JSON.stringify({
            symbol: item.symbol,
            base: item.base,
            date
          })
        })
        const json = await res.json()
        if (json.success) {
          // 重新拉取以获取完整数据
          fetchFavorites()
        }
      }
    },
    [loggedIn, favSymbolSet, date, fetchFavorites]
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
          `${base}/api/daily-analysis?date=${date}&minQuoteVolume=${minQuoteVolume}`,
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
          <div className="w-full md:w-[280px] shrink-0 flex flex-col">
            {/* 搜索框 */}
            <div className="bg-[#18181b] rounded-xl border border-gray-800 overflow-hidden flex flex-col flex-1">
              <div className="px-3 pt-2 pb-1.5 shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索币种..."
                    className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200
                               placeholder:text-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              {/* Tab 切换 */}
              <div className="flex px-3 gap-1 shrink-0">
                <button
                  onClick={() => setActiveTab('daily')}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    activeTab === 'daily'
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  每日
                </button>
                <button
                  onClick={() => setActiveTab('all')}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    activeTab === 'all'
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  全部
                </button>
                {loggedIn && (
                  <button
                    onClick={() => setActiveTab('fav')}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors flex items-center justify-center gap-1 ${
                      activeTab === 'fav'
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Star className="w-3 h-3" />
                    自选
                  </button>
                )}
              </div>

              {/* 列表列头 */}
              {activeTab === 'daily' && (
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
              )}

              {/* 全部 Tab 列头 */}
              {activeTab === 'all' && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50 text-[10px] text-gray-600 uppercase tracking-wider shrink-0">
                  <span className="w-5 shrink-0" />
                  <span className="flex-1 flex items-center gap-2">
                    <button
                      onClick={() => toggleAllSort('base')}
                      className={`flex items-center gap-0.5 hover:text-gray-400 transition-colors ${allSortKey === 'base' ? 'text-primary' : ''}`}
                    >
                      币种 <ArrowUpDown className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={() => toggleAllSort('quoteVol')}
                      className={`flex items-center gap-0.5 hover:text-gray-400 transition-colors ${allSortKey === 'quoteVol' ? 'text-primary' : ''}`}
                    >
                      量 <ArrowUpDown className="w-2.5 h-2.5" />
                    </button>
                  </span>
                  <span className="flex items-center justify-end gap-2 min-w-[88px]">
                    <button
                      onClick={() => toggleAllSort('price')}
                      className={`flex items-center gap-0.5 hover:text-gray-400 transition-colors ${allSortKey === 'price' ? 'text-primary' : ''}`}
                    >
                      价格 <ArrowUpDown className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={() => toggleAllSort('change')}
                      className={`flex items-center gap-0.5 hover:text-gray-400 transition-colors ${allSortKey === 'change' ? 'text-primary' : ''}`}
                    >
                      涨跌 <ArrowUpDown className="w-2.5 h-2.5" />
                    </button>
                  </span>
                </div>
              )}

              {/* 自选 Tab 列头 */}
              {activeTab === 'fav' && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50 text-[10px] text-gray-600 uppercase tracking-wider shrink-0">
                  <span className="w-12 shrink-0 text-center">日期</span>
                  <span className="flex-1">币种</span>
                  <span className="w-[88px] text-right">价格/量</span>
                  <span className="w-[60px] text-right">涨跌幅</span>
                </div>
              )}

              {/* 列表内容 */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'daily' && (
                  <>
                    {(() => {
                      const filtered = searchQuery
                        ? allItems.filter(item =>
                            item.base
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase())
                          )
                        : allItems
                      return filtered.length === 0 ? (
                        <div className="text-center text-gray-500 py-12 text-xs">
                          暂无数据
                        </div>
                      ) : (
                        filtered.slice(0, 100).map((item, i) => {
                          const sel = selectedItem?.symbol === item.symbol
                          const isFav = favSymbolSet.has(item.symbol)
                          return (
                            <div
                              key={item.symbol}
                              className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b border-gray-800/30 cursor-pointer transition-colors ${
                                sel
                                  ? 'bg-primary/10 border-l-2 border-l-primary'
                                  : 'hover:bg-gray-800/30'
                              }`}
                              onClick={() => setSelectedItem(item)}
                            >
                              {/* 序号 / 收藏图标 */}
                              <span
                                className="w-5 shrink-0 text-center"
                                onClick={e => {
                                  if (!loggedIn) return
                                  e.stopPropagation()
                                  toggleFavorite(item)
                                }}
                              >
                                {loggedIn && isFav ? (
                                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 mx-auto" />
                                ) : loggedIn ? (
                                  <Star className="w-3 h-3 text-gray-500 hover:text-yellow-400 mx-auto transition-colors" />
                                ) : (
                                  <span className="text-gray-600">{i + 1}</span>
                                )}
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
                      )
                    })()}
                  </>
                )}

                {activeTab === 'all' && (
                  <>
                    {(() => {
                      const items = data?.allItems ?? []
                      if (items.length === 0)
                        return (
                          <div className="text-center text-gray-500 py-12 text-xs">
                            暂无数据
                          </div>
                        )
                      const filtered = searchQuery
                        ? items.filter(item =>
                            item.base
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase())
                          )
                        : items
                      // 排序
                      const sorted = [...filtered].sort((a, b) => {
                        const ta = tickerMap[toBinanceSymbol(a.symbol)]
                        const tb = tickerMap[toBinanceSymbol(b.symbol)]
                        const mul = allSortAsc ? 1 : -1
                        switch (allSortKey) {
                          case 'price':
                            return (
                              (Number(ta?.price ?? 0) -
                                Number(tb?.price ?? 0)) *
                              mul
                            )
                          case 'change':
                            return (
                              (Number(ta?.change ?? 0) -
                                Number(tb?.change ?? 0)) *
                              mul
                            )
                          case 'quoteVol':
                            return (
                              (Number(ta?.quoteVol ?? 0) -
                                Number(tb?.quoteVol ?? 0)) *
                              mul
                            )
                          case 'base':
                            return a.base.localeCompare(b.base) * mul
                          default:
                            return 0
                        }
                      })
                      return sorted.length === 0 ? (
                        <div className="text-center text-gray-500 py-12 text-xs">
                          暂无数据
                        </div>
                      ) : (
                        sorted.map(item => {
                          const ticker = tickerMap[toBinanceSymbol(item.symbol)]
                          const sel = selectedItem?.symbol === item.symbol
                          const isFav = favSymbolSet.has(item.symbol)
                          return (
                            <div
                              key={item.symbol}
                              className={`flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-800/30 cursor-pointer transition-colors ${
                                sel
                                  ? 'bg-primary/10 border-l-2 border-l-primary'
                                  : 'hover:bg-gray-800/30'
                              }`}
                              onClick={() => setSelectedItem(item)}
                            >
                              {/* 收藏图标 */}
                              <span
                                className="w-5 shrink-0 text-center"
                                onClick={e => {
                                  if (!loggedIn) return
                                  e.stopPropagation()
                                  toggleFavorite(item)
                                }}
                              >
                                {loggedIn && isFav ? (
                                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 mx-auto" />
                                ) : loggedIn ? (
                                  <Star className="w-3 h-3 text-gray-500 hover:text-yellow-400 mx-auto transition-colors" />
                                ) : (
                                  <span className="w-3 h-3" />
                                )}
                              </span>
                              {/* 币种 + 量 */}
                              <span className="flex-1 flex flex-col min-w-0 leading-tight">
                                <span className="font-medium text-gray-200 truncate">
                                  {item.base}
                                </span>
                                <span className="text-gray-500 truncate text-[10px]">
                                  {ticker
                                    ? fmtVol(Number(ticker.quoteVol))
                                    : '--'}
                                </span>
                              </span>
                              {/* 价格 + 涨跌幅 */}
                              <span className="flex flex-col items-end leading-tight shrink-0 min-w-[88px]">
                                <span className="font-mono tabular-nums text-gray-200">
                                  {ticker
                                    ? Number(ticker.price).toFixed(2)
                                    : '--'}
                                </span>
                                <span
                                  className={`text-[10px] ${
                                    ticker
                                      ? Number(ticker.change) >= 0
                                        ? 'text-emerald-400'
                                        : 'text-red-400'
                                      : 'text-gray-600'
                                  }`}
                                >
                                  {ticker
                                    ? `${Number(ticker.change) >= 0 ? '+' : ''}${Number(ticker.change).toFixed(2)}%`
                                    : '--'}
                                </span>
                              </span>
                            </div>
                          )
                        })
                      )
                    })()}
                  </>
                )}

                {activeTab === 'fav' && (
                  <>
                    {favLoading ? (
                      <div className="text-center text-gray-500 py-12 text-xs">
                        加载中...
                      </div>
                    ) : favorites.length === 0 ? (
                      <div className="text-center text-gray-500 py-12 text-xs">
                        {loggedIn ? '在全部列表中收藏币种' : '登录后可收藏币种'}
                      </div>
                    ) : (
                      (() => {
                        const filtered = searchQuery
                          ? favorites.filter(f =>
                              f.base
                                .toLowerCase()
                                .includes(searchQuery.toLowerCase())
                            )
                          : favorites
                        return filtered.map(fav => {
                          const ticker = tickerMap[toBinanceSymbol(fav.symbol)]
                          const sel = selectedItem?.symbol === fav.symbol
                          return (
                            <div
                              key={fav.symbol}
                              onClick={() => {
                                const item = data.rankAmplitude.find(
                                  i => i.symbol === fav.symbol
                                )
                                if (item) setSelectedItem(item)
                              }}
                              className={`flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-800/30 cursor-pointer transition-colors ${
                                sel
                                  ? 'bg-primary/10 border-l-2 border-l-primary'
                                  : 'hover:bg-gray-800/30'
                              }`}
                            >
                              <span className="w-12 shrink-0 text-center text-gray-500 text-[10px]">
                                {fav.date.slice(5)}
                              </span>
                              <span className="flex-1 flex flex-col min-w-0 leading-tight">
                                <span className="font-medium text-gray-200 truncate">
                                  {fav.base}
                                </span>
                                <span className="text-gray-500 truncate text-[10px]">
                                  /USDT
                                </span>
                              </span>
                              <span className="w-[88px] flex flex-col items-end leading-tight shrink-0">
                                <span className="font-mono tabular-nums text-gray-200">
                                  {ticker
                                    ? Number(ticker.price).toFixed(2)
                                    : '--'}
                                </span>
                                <span className="text-gray-500 text-[10px]">
                                  {ticker
                                    ? fmtVol(Number(ticker.quoteVol))
                                    : '--'}
                                </span>
                              </span>
                              <span
                                className={`w-[60px] text-right font-medium ${
                                  ticker
                                    ? Number(ticker.change) >= 0
                                      ? 'text-emerald-400'
                                      : 'text-red-400'
                                    : 'text-gray-600'
                                }`}
                              >
                                {ticker
                                  ? `${Number(ticker.change) >= 0 ? '+' : ''}${Number(ticker.change).toFixed(2)}%`
                                  : '--'}
                              </span>
                            </div>
                          )
                        })
                      })()
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              {activeTab === 'daily' && (
                <div className="px-3 py-2 border-t border-gray-800/50 text-[10px] text-gray-600 flex gap-3 shrink-0">
                  <span>共 {data.totalSymbols} 个</span>
                  <span>筛选 {data.filteredCount} 个</span>
                </div>
              )}
              {activeTab === 'all' && (
                <div className="px-3 py-2 border-t border-gray-800/50 text-[10px] text-gray-600 shrink-0">
                  <span>
                    全部 {data?.allItems?.length ?? data?.filteredCount ?? 0} 个
                  </span>
                </div>
              )}
              {activeTab === 'fav' && (
                <div className="px-3 py-2 border-t border-gray-800/50 text-[10px] text-gray-600 shrink-0">
                  <span>自选 {favorites.length} 个</span>
                </div>
              )}
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
