'use client'

import {useCallback, useState, useEffect, useMemo, useRef} from 'react'
import {
  Activity,
  Crosshair,
  AlertCircle,
  ArrowUpDown,
  Star,
  Search,
  RefreshCw,
  ChevronLeft,
  Download
} from 'lucide-react'
import type {DailyAnalysisResult, DailyAnalysisItem} from '@nexttrade/shared'
import type {FavoriteSymbol} from '@nexttrade/shared'
import dynamic from 'next/dynamic'
import {useRouter} from 'next/navigation'
import {authHeaders, getToken, API_ORIGIN} from '@/lib/api'
import {useDeviceType} from '@/hooks/useDeviceType'
import {useUserConfig} from '@/hooks/useUserConfig'
import {useTickerWs, type TickerData} from '@/hooks/useTickerWs'

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
function fmtPrice(n: number): string {
  if (n >= 1000) return n.toFixed(2)
  if (n >= 1) return n.toFixed(4)
  if (n >= 0.01) return n.toFixed(6)
  return n.toFixed(8)
}

/** 稳定币基础币种列表（过滤掉 USDT 永续中的稳定币对） */
const STABLECOINS = new Set([
  'USDC',
  'FDUSD',
  'USDP',
  'DAI',
  'TUSD',
  'BUSD',
  'GUSD',
  'SUSD',
  'LUSD',
  'FRAX',
  'MIM',
  'ALUSD',
  'EURS',
  'CEUR',
  'USTC',
  'USDN'
])

type AllSortKey = 'price' | 'change' | 'quoteVol' | 'base'

export default function DailyAnalysisPage() {
  const userConfig = useUserConfig()
  const dailyMinQuote = userConfig.dailyMinQuoteVolume || 20000000
  const allMinQuote = userConfig.allMinQuoteVolume ?? 0

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
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('change')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectedItem, setSelectedItem] = useState<DailyAnalysisItem | null>(
    null
  )
  const {isMobile} = useDeviceType()
  const router = useRouter()
  const [chartExpanded, setChartExpanded] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'fav' | 'today' | 'yesterday'>(
    'fav'
  )

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
  // ─── 收藏 ───
  const [favorites, setFavorites] = useState<FavoriteSymbol[]>([])
  const [favLoading, setFavLoading] = useState(false)
  const loggedIn = typeof window !== 'undefined' && !!getToken()

  // ─── 实时 Ticker 数据（WebSocket） ───
  const [tickerMap, setTickerMap] = useState<Record<string, TickerData>>({})
  const tickerMapRef = useRef(tickerMap)
  tickerMapRef.current = tickerMap

  const handleTickers = useCallback((tickers: TickerData[]) => {
    const map: Record<string, TickerData> = {}
    for (const t of tickers) {
      map[t.symbol] = t
    }
    setTickerMap(prev => ({...prev, ...map}))
  }, [])

  useTickerWs(handleTickers)

  // ─── 获取收藏列表 ───
  const fetchFavorites = useCallback(async () => {
    if (!loggedIn) {
      setFavorites([])
      return
    }
    setFavLoading(true)
    try {
      const res = await fetch(`${API_ORIGIN}/api/favorites`, {
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

      if (favSymbolSet.has(item.symbol)) {
        // 取消收藏
        await fetch(
          `${API_ORIGIN}/api/favorites/${encodeURIComponent(item.symbol)}`,
          {method: 'DELETE', headers: authHeaders()}
        )
        setFavorites(prev => prev.filter(f => f.symbol !== item.symbol))
      } else {
        // 添加收藏
        const res = await fetch(`${API_ORIGIN}/api/favorites`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', ...authHeaders()},
          body: JSON.stringify({
            symbol: item.symbol,
            base: item.base
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
    async (signal: AbortSignal, isRetry = false, force = false) => {
      setLoading(true)
      if (!isRetry) setError(null)
      try {
        const params = new URLSearchParams({
          date,
          minQuoteVolume: String(dailyMinQuote)
        })
        if (force) params.set('force', 'true')
        const res = await fetch(`${API_ORIGIN}/api/daily-analysis?${params}`, {
          signal
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error ?? 'Request failed')
        if (!json.data && !isRetry) return fetchAnalysis(signal, true)
        setData(json.data as DailyAnalysisResult)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError((e as Error).message)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [date, dailyMinQuote]
  )

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    const c = new AbortController()
    fetchAnalysis(c.signal, false, true)
  }, [fetchAnalysis])

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

  const selectSymbol = useCallback(
    (item: DailyAnalysisItem) => {
      if (isMobile) {
        // 移动端跳转到独立 K 线路由页面
        router.push(
          `/daily-analysis/kline?symbol=${encodeURIComponent(item.symbol)}&date=${encodeURIComponent(date)}`
        )
      } else {
        setSelectedItem(item)
        window.history.pushState(
          null,
          '',
          `/daily-analysis?symbol=${encodeURIComponent(item.symbol)}`
        )
      }
    },
    [isMobile, router, date]
  )

  const closeSymbol = useCallback(() => {
    setSelectedItem(null)
    window.history.pushState(null, '', '/daily-analysis')
  }, [])

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 h-full flex flex-col overflow-hidden">
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-3 sm:p-4 mb-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-200">
              每日行情
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {clock && (
              <span className="text-xs font-mono tabular-nums text-gray-400">
                {clock}
              </span>
            )}
            {(loading || refreshing) && (
              <span className="flex items-center gap-1.5 text-xs text-primary">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {refreshing ? '刷新中' : '加载中'}
              </span>
            )}
            <a
              href="/about"
              className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="介绍与下载"
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-3 mb-4 shrink-0 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col md:flex-row gap-3 lg:gap-4 flex-1 min-h-0 overflow-hidden">
          {/* 左栏 — 放大时隐藏 */}
          <div
            className={`w-full md:w-[220px] lg:w-[280px] flex flex-col flex-1 md:flex-none min-h-0 ${chartExpanded ? 'hidden' : ''}`}
          >
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
                    className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg pl-8 pr-3 py-2 md:py-1.5 text-sm text-gray-200
                               placeholder:text-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              {/* Tab 切换 — 关注/今日/昨日 */}
              <div className="flex px-3 gap-1 shrink-0">
                <button
                  onClick={() => setActiveTab('fav')}
                  className={`flex-1 text-xs py-1 rounded-md transition-colors flex items-center justify-center gap-1 ${
                    activeTab === 'fav'
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Star className="w-2.5 h-2.5" />
                  关注
                </button>
                <button
                  onClick={() => setActiveTab('today')}
                  className={`flex-1 text-xs py-1 rounded-md transition-colors ${
                    activeTab === 'today'
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  今日
                </button>
                <button
                  onClick={() => setActiveTab('yesterday')}
                  className={`flex-1 text-xs py-1 rounded-md transition-colors ${
                    activeTab === 'yesterday'
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  昨日
                </button>
              </div>

              {/* 列表列头 */}
              {activeTab === 'yesterday' && (
                <div>
                  {/* 昨日日期选择 */}
                  <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-gray-800/30 shrink-0">
                    <input
                      type="date"
                      value={date}
                      max={yesterdayUTC()}
                      onChange={e => setDate(e.target.value)}
                      className="bg-[#0a0a0b] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200
                                 focus:outline-none focus:border-blue-500 transition-colors [color-scheme:dark] w-36"
                    />
                    <button
                      onClick={handleRefresh}
                      disabled={refreshing}
                      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-primary transition-colors disabled:opacity-50"
                      title="重新拉取数据"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50 text-xs text-gray-600 uppercase tracking-wider shrink-0">
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
                </div>
              )}

              {/* 今日 Tab 列头 */}
              {activeTab === 'today' && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50 text-xs text-gray-600 uppercase tracking-wider shrink-0">
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

              {/* 关注 Tab 列头 */}
              {activeTab === 'fav' && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50 text-xs text-gray-600 uppercase tracking-wider shrink-0" />
              )}

              {/* 列表内容 */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'yesterday' && (
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
                              className={`flex items-center gap-1.5 px-2 py-1.5 text-xs border-b border-gray-800/30 cursor-pointer transition-colors ${
                                sel
                                  ? 'bg-primary/10 border-l-2 border-l-primary'
                                  : 'hover:bg-gray-800/30'
                              }`}
                              onClick={() => selectSymbol(item)}
                            >
                              {/* 序号 / 收藏图标 */}
                              <span
                                className="w-4 shrink-0 text-center"
                                onClick={e => {
                                  if (!loggedIn) return
                                  e.stopPropagation()
                                  toggleFavorite(item)
                                }}
                              >
                                {loggedIn && isFav ? (
                                  <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400 mx-auto" />
                                ) : loggedIn ? (
                                  <Star className="w-2.5 h-2.5 text-gray-500 hover:text-yellow-400 mx-auto transition-colors" />
                                ) : (
                                  <span className="text-gray-600">{i + 1}</span>
                                )}
                              </span>
                              <span className="flex-1 flex flex-col min-w-0 leading-tight">
                                <span className="font-medium text-gray-200 truncate flex items-center gap-1">
                                  {item.base}
                                  {item.isDoji && (
                                    <Crosshair className="w-2 h-2 text-yellow-400 shrink-0" />
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

                {activeTab === 'today' && (
                  <>
                    {(() => {
                      const tickerKeys = Object.keys(tickerMap)
                      if (tickerKeys.length === 0)
                        return (
                          <div className="text-center text-gray-500 py-12 text-xs">
                            加载中...
                          </div>
                        )
                      // 只保留 USDT 永续（过滤稳定币）
                      const entries = tickerKeys
                        .filter(s => {
                          if (!s.endsWith('USDT')) return false
                          const base = s.replace('USDT', '')
                          return !STABLECOINS.has(base)
                        })
                        .map(s => ({
                          binanceSymbol: s,
                          base: s.replace('USDT', ''),
                          ticker: tickerMap[s]
                        }))
                      // 按交易量过滤
                      const volumeFiltered =
                        allMinQuote > 0
                          ? entries.filter(
                              e => Number(e.ticker.quoteVol) >= allMinQuote
                            )
                          : entries
                      const filtered = searchQuery
                        ? volumeFiltered.filter(e =>
                            e.base
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase())
                          )
                        : volumeFiltered
                      // 排序
                      const sorted = [...filtered].sort((a, b) => {
                        const mul = allSortAsc ? 1 : -1
                        switch (allSortKey) {
                          case 'price':
                            return (
                              (Number(a.ticker.price) -
                                Number(b.ticker.price)) *
                              mul
                            )
                          case 'change':
                            return (
                              (Number(a.ticker.change) -
                                Number(b.ticker.change)) *
                              mul
                            )
                          case 'quoteVol':
                            return (
                              (Number(a.ticker.quoteVol) -
                                Number(b.ticker.quoteVol)) *
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
                        sorted.map(entry => {
                          const {binanceSymbol, base, ticker} = entry
                          const fullSymbol = binanceSymbol
                          const sel = selectedItem?.symbol === fullSymbol
                          const isFav = favSymbolSet.has(fullSymbol)
                          // 点击时尝试从 data 找 item，否则用一个最小对象
                          const findOrCreateItem = () => {
                            const found = data?.allItems?.find(
                              i => i.symbol === fullSymbol
                            )
                            if (found) return found
                            return {
                              symbol: fullSymbol,
                              base,
                              open: Number(ticker.open),
                              high: Number(ticker.high),
                              low: Number(ticker.low),
                              close: Number(ticker.price),
                              amplitude: 0,
                              change: Number(ticker.change),
                              quoteVolume: Number(ticker.quoteVol),
                              isDoji: false
                            }
                          }
                          return (
                            <div
                              key={binanceSymbol}
                              className={`flex items-center gap-1.5 px-2 py-1.5 text-xs border-b border-gray-800/30 cursor-pointer transition-colors ${
                                sel
                                  ? 'bg-primary/10 border-l-2 border-l-primary'
                                  : 'hover:bg-gray-800/30'
                              }`}
                              onClick={() => selectSymbol(findOrCreateItem())}
                            >
                              {/* 收藏图标 */}
                              <span
                                className="w-4 shrink-0 text-center"
                                onClick={e => {
                                  if (!loggedIn) return
                                  e.stopPropagation()
                                  toggleFavorite(findOrCreateItem())
                                }}
                              >
                                {loggedIn && isFav ? (
                                  <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400 mx-auto" />
                                ) : loggedIn ? (
                                  <Star className="w-2.5 h-2.5 text-gray-500 hover:text-yellow-400 mx-auto transition-colors" />
                                ) : (
                                  <span className="w-2.5 h-2.5" />
                                )}
                              </span>
                              {/* 币种 + 量 */}
                              <span className="flex-1 flex flex-col min-w-0 leading-tight">
                                <span className="font-medium text-gray-200 truncate">
                                  {base}
                                </span>
                                <span className="text-gray-500 truncate text-[10px]">
                                  {fmtVol(Number(ticker.quoteVol))}
                                </span>
                              </span>
                              {/* 价格 + 涨跌幅 */}
                              <span className="flex flex-col items-end leading-tight shrink-0 min-w-[88px]">
                                <span className="font-mono tabular-nums text-gray-200">
                                  {fmtPrice(Number(ticker.price))}
                                </span>
                                <span
                                  className={`text-[10px] ${
                                    Number(ticker.change) >= 0
                                      ? 'text-emerald-400'
                                      : 'text-red-400'
                                  }`}
                                >
                                  {Number(ticker.change) >= 0 ? '+' : ''}
                                  {Number(ticker.change).toFixed(2)}%
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
                        {loggedIn ? '在今日列表中收藏币种' : '登录后可收藏币种'}
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
                          const ticker = tickerMap[fav.symbol]
                          const sel = selectedItem?.symbol === fav.symbol
                          return (
                            <div
                              key={fav.symbol}
                              onClick={() => {
                                const item = data?.rankAmplitude.find(
                                  i => i.symbol === fav.symbol
                                )
                                if (item) selectSymbol(item)
                              }}
                              className={`flex items-center gap-1.5 px-2 py-1.5 text-xs border-b border-gray-800/30 cursor-pointer transition-colors ${
                                sel
                                  ? 'bg-primary/10 border-l-2 border-l-primary'
                                  : 'hover:bg-gray-800/30'
                              }`}
                            >
                              <span
                                className="w-4 shrink-0 text-center cursor-pointer"
                                onClick={e => {
                                  e.stopPropagation()
                                  const item = {
                                    symbol: fav.symbol,
                                    base: fav.base,
                                    open: 0,
                                    high: 0,
                                    low: 0,
                                    close: 0,
                                    amplitude: 0,
                                    change: 0,
                                    quoteVolume: 0,
                                    isDoji: false
                                  }
                                  toggleFavorite(item)
                                }}
                              >
                                <Star className="w-2.5 h-2.5 text-yellow-400 fill-yellow-400 mx-auto hover:opacity-70 transition-opacity" />
                              </span>
                              {/* 币种 + 量 */}
                              <span className="flex-1 flex flex-col min-w-0 leading-tight">
                                <span className="font-medium text-gray-200 truncate">
                                  {fav.base}
                                </span>
                                <span className="text-gray-500 truncate text-[10px]">
                                  {ticker
                                    ? fmtVol(Number(ticker.quoteVol))
                                    : '--'}
                                </span>
                              </span>
                              {/* 近 10 天振幅榜前 10 次数 */}
                              <span
                                className="text-[10px] text-gray-600 shrink-0 mr-2"
                                title="近10天进入振幅榜前10的次数"
                              >
                                {fav.top10Count != null
                                  ? `🏆 ${fav.top10Count}次`
                                  : ''}
                              </span>
                              {/* 价格 + 涨跌幅 */}
                              <span className="flex flex-col items-end leading-tight shrink-0 min-w-[88px]">
                                <span className="font-mono tabular-nums text-gray-200">
                                  {ticker
                                    ? fmtPrice(Number(ticker.price))
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
                      })()
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              {activeTab === 'yesterday' && (
                <div className="px-3 py-2 border-t border-gray-800/50 text-xs text-gray-600 flex gap-2 shrink-0">
                  <span>共 {data.totalSymbols} 个</span>
                  <span>筛选 {data.filteredCount} 个</span>
                  <span className="text-gray-500">
                    ≥ {(dailyMinQuote / 1000000).toFixed(0)}M
                  </span>
                </div>
              )}
              {activeTab === 'today' && (
                <div className="px-3 py-2 border-t border-gray-800/50 text-xs text-gray-600 flex gap-2 shrink-0">
                  <span>
                    {
                      Object.keys(tickerMap).filter(s => {
                        if (!s.endsWith('USDT')) return false
                        return !STABLECOINS.has(s.replace('USDT', ''))
                      }).length
                    }{' '}
                    个
                  </span>
                  {allMinQuote > 0 && (
                    <span className="text-gray-500">
                      ≥ {(allMinQuote / 1000000).toFixed(0)}M
                    </span>
                  )}
                </div>
              )}
              {activeTab === 'fav' && (
                <div className="px-3 py-2 border-t border-gray-800/50 text-xs text-gray-600 shrink-0">
                  <span>关注 {favorites.length} 个</span>
                </div>
              )}
            </div>
          </div>

          {/* 右栏 */}
          <div className="flex-1 min-w-0 hidden md:block">
            {selectedItem ? (
              <SymbolDetail
                item={selectedItem}
                selectedDate={date}
                onClose={closeSymbol}
                expanded={chartExpanded}
                onExpandToggle={() => setChartExpanded(v => !v)}
                ticker={tickerMap[selectedItem.symbol]}
              />
            ) : (
              <div className="bg-[#18181b] rounded-xl border border-gray-800 flex items-center justify-center min-h-[300px] h-full">
                <div className="text-center text-gray-600">
                  <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">点击左侧币种查看 K 线图与复盘</p>
                </div>
              </div>
            )}
          </div>

          {/* 移动端 K 线已跳转到独立路由 /daily-analysis/kline */}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="flex-1 min-h-0 flex items-center justify-center text-center text-gray-500">
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
