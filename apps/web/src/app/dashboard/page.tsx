'use client'

import {useCallback, useEffect, useState} from 'react'
import {
  Volume2,
  VolumeX,
  Bell,
  Play,
  AlertTriangle
} from 'lucide-react'
import {Toaster, toast} from 'sonner'
import {ChartCard} from '@/components/ChartCard'
import {useAlertStream, useLatestAlerts} from '@/hooks/useAlertStream'
import {useAudioAlert} from '@/hooks/useAudioAlert'
import type {PriceAlert, WatchlistItem} from '@nexttrade/shared'

const API_BASE =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''

function yesterdayUTC(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * 主看板页面
 */
export default function DashboardPage() {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(yesterdayUTC())
  const {lastAlert, isConnected} = useAlertStream()
  const alerts = useLatestAlerts()
  const {isMuted, toggleMute, playTest, unlock} = useAudioAlert(lastAlert)

  // 按日期加载 + 自动同步
  const loadForDate = useCallback(async (targetDate: string, isRetry = false) => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/market/watchlist?date=${targetDate}`)
      const json = await res.json()
      if (json.success && json.data?.items?.length > 0) {
        setItems(json.data.items)
      } else if (!isRetry) {
        // 无数据 → 自动触发同步，完成后重试
        await fetch(`${API_BASE}/api/market/watchlist/sync?date=${targetDate}`)
        await loadForDate(targetDate, true)
      }
    } catch (err) {
      console.error('[dashboard] Error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 日期变化或首次加载
  useEffect(() => {
    const h = () => { unlock(); document.removeEventListener('click', h) }
    document.addEventListener('click', h)
    loadForDate(date)
    const timer = setInterval(() => loadForDate(date), 30_000)
    return () => { clearInterval(timer); document.removeEventListener('click', h) }
  }, [date, loadForDate, unlock])

  // 告警 Toast
  useEffect(() => {
    if (!lastAlert) return
    const icon = lastAlert.severity === 'danger' ? '🔴' : '🟡'
    toast(icon + ' ' + lastAlert.message, {
      duration: 4000,
      position: 'top-right'
    })
  }, [lastAlert])

  // 跑马灯消息 (最近 5 条)
  const tickerMessages = alerts
    .slice(0, 5)
    .map(a => `${a.base}: ${a.message}`)
    .join('  ·  ')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster
        toastOptions={{
          style: {
            background: '#18181b',
            color: '#fafafa',
            border: '1px solid #27272a'
          }
        }}
      />

      {/* ─── 顶部栏 ─── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 sm:px-6 h-12">
          {/* 左: 标题 + 连接状态 */}
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold">实时看板</h1>
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-500' : 'bg-red-500'
              }`}
              title={isConnected ? 'SSE 已连接' : 'SSE 断开'}
            />
            <span className="text-[11px] text-muted-foreground">
              {items.length} 个标的
            </span>
          </div>

          {/* 右: 日期 + 声音控制 */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              max={yesterdayUTC()}
              onChange={e => setDate(e.target.value)}
              className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground
                         focus:outline-none focus:border-primary transition-colors [color-scheme:dark] w-32"
            />
            {loading && (
              <span className="text-xs text-muted-foreground animate-pulse">加载中</span>
            )}
            <button
              onClick={playTest}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground
                         hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
              title="测试音效"
            >
              <Play className="w-3.5 h-3.5" />
              测试
            </button>
            <button
              onClick={toggleMute}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors
                ${isMuted ? 'text-muted-foreground hover:text-foreground' : 'text-emerald-400'}`}
              title={isMuted ? '开启声音' : '静音'}
            >
              {isMuted ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
              {isMuted ? '静音' : '有声'}
            </button>
          </div>
        </div>

        {/* ─── 告警跑马灯 ─── */}
        {tickerMessages && (
          <div className="overflow-hidden border-t border-border h-7 flex items-center">
            <div className="flex items-center gap-2 px-4 text-xs text-yellow-400 shrink-0">
              <Bell className="w-3 h-3" />
            </div>
            <div className="overflow-hidden relative flex-1">
              <div className="animate-marquee whitespace-nowrap text-xs text-muted-foreground">
                {tickerMessages}
                <span className="mx-8">{tickerMessages}</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ─── 加载状态 ─── */}
      {loading && (
        <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            加载中...
          </div>
        </div>
      )}

      {/* ─── 空状态 ─── */}
      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <AlertTriangle className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">暂无活跃标的</p>
          <p className="text-xs mt-1">
            请先执行{' '}
            <code className="bg-muted px-1 rounded text-primary">
              POST /api/market/watchlist/sync
            </code>
          </p>
        </div>
      )}

      {/* ─── 图表网格 ─── */}
      {items.length > 0 && (
        <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {items.map(item => (
            <ChartCard
              key={item.symbol}
              symbol={item.symbol}
              base={item.base}
              dayHigh={item.dayHigh}
              dayLow={item.dayLow}
              vwap={item.vwap}
              lastPrice={item.lastPrice}
              isSqueeze={item.isSqueeze}
              alert={lastAlert?.symbol === item.symbol ? lastAlert : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}
