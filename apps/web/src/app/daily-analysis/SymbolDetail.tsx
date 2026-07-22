'use client'

import {useState, useCallback, useEffect} from 'react'
import {X, Tag, BookOpen} from 'lucide-react'
import type {IChartApi, ISeriesApi} from 'lightweight-charts'
import type {SymbolJournal} from '@nexttrade/shared'
import dynamic from 'next/dynamic'

// 动态导入避免 SSR 时 lightweight-charts 报错
const KlineChart = dynamic(() => import('@/components/chart/KlineChart'), {ssr: false})
const DrawingOverlay = dynamic(() => import('@/components/chart/DrawingOverlay'), {ssr: false})
const DrawingTools = dynamic(() => import('@/components/chart/DrawingTools'), {ssr: false})
const TagSelector = dynamic(() => import('@/components/tags/TagSelector'), {ssr: false})
const JournalEntryComp = dynamic(() => import('@/components/journal/JournalEntry'), {ssr: false})
const JournalListComp = dynamic(() => import('@/components/journal/JournalList'), {ssr: false})

import type {TrendLine} from '@/components/chart/DrawingOverlay'
import type {DailyAnalysisItem} from '@nexttrade/shared'

const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const

interface SymbolDetailProps {
  item: DailyAnalysisItem
  selectedDate: string
  onClose: () => void
}

export default function SymbolDetail({item, selectedDate, onClose}: SymbolDetailProps) {
  const [timeframe, setTimeframe] = useState<string>('1h')
  const [activeTool, setActiveTool] = useState<'horizontal' | 'trendline' | null>(null)
  const [trendLines, setTrendLines] = useState<TrendLine[]>([])
  const [chart, setChart] = useState<IChartApi | null>(null)
  const [candleSeries, setCandleSeries] = useState<ISeriesApi<'Candlestick'> | null>(null)
  const [activeTab, setActiveTab] = useState<'chart' | 'tags' | 'journal'>('chart')
  const [journals, setJournals] = useState<SymbolJournal[]>([])
  const [editingJournal, setEditingJournal] = useState<SymbolJournal | null>(null)

  // 加载日记列表
  useEffect(() => {
    fetch(`/api/symbols/${encodeURIComponent(item.symbol)}/journals`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setJournals(d.data)
      })
      .catch(() => {})
  }, [item.symbol])

  const handleChartReady = useCallback(
    (c: IChartApi, cs: ISeriesApi<'Candlestick'>) => {
      setChart(c)
      setCandleSeries(cs)
    },
    []
  )

  const handleAddTrendLine = useCallback((line: Omit<TrendLine, 'id'>) => {
    setTrendLines(prev => [...prev, {...line, id: crypto.randomUUID()}])
    setActiveTool(null)
  }, [])

  const handleClearAll = useCallback(() => {
    setTrendLines([])
  }, [])

  const handleChartClick = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'horizontal' || !candleSeries || !chart) return

      const container = e.currentTarget as HTMLElement
      const rect = container.getBoundingClientRect()
      const y = e.clientY - rect.top
      const price = candleSeries.coordinateToPrice(y)
      if (price === null) return

      candleSeries.createPriceLine({
        price,
        color: '#3b82f6',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: price.toFixed(4)
      })
      setActiveTool(null)
    },
    [activeTool, candleSeries, chart]
  )

  const handleJournalSaved = useCallback((journal: SymbolJournal) => {
    setJournals(prev => {
      const idx = prev.findIndex(j => j.date === journal.date)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = journal
        return next
      }
      return [journal, ...prev]
    })
    setEditingJournal(null)
  }, [])

  const handleJournalDelete = useCallback(
    async (id: number) => {
      setJournals(prev => prev.filter(j => j.id !== id))
      await fetch(`/api/symbols/${encodeURIComponent(item.symbol)}/journals/${id}`, {
        method: 'DELETE'
      }).catch(() => {})
    },
    [item.symbol]
  )

  return (
    <div className="mt-4 p-4 rounded-xl bg-[#18181b] border border-gray-700/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-gray-100">
            {item.base}{' '}
            <span className="text-sm text-gray-500 font-normal">/USDT</span>
          </h3>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>O:<span className="text-gray-300 ml-1">{item.open.toFixed(4)}</span></span>
            <span>H:<span className="text-gray-300 ml-1">{item.high.toFixed(4)}</span></span>
            <span>L:<span className="text-gray-300 ml-1">{item.low.toFixed(4)}</span></span>
            <span>C:<span className="text-gray-300 ml-1">{item.close.toFixed(4)}</span></span>
          </div>
          <span className={`text-xs font-medium ${item.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
          </span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-3 border-b border-gray-700/30 pb-0">
        <button
          onClick={() => setActiveTab('chart')}
          className={`text-xs px-3 py-1.5 -mb-[1px] border-b transition-colors ${
            activeTab === 'chart'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          图表
        </button>
        <button
          onClick={() => setActiveTab('tags')}
          className={`text-xs px-3 py-1.5 -mb-[1px] border-b transition-colors flex items-center gap-1 ${
            activeTab === 'tags'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Tag className="w-3 h-3" /> 标签
        </button>
        <button
          onClick={() => setActiveTab('journal')}
          className={`text-xs px-3 py-1.5 -mb-[1px] border-b transition-colors flex items-center gap-1 ${
            activeTab === 'journal'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <BookOpen className="w-3 h-3" /> 日记
        </button>
      </div>

      {activeTab === 'chart' && (
        <>
          {/* Timeframe + Drawing Tools */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-primary/20 text-primary'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
            <DrawingTools
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              onClearAll={handleClearAll}
              hasDrawings={trendLines.length > 0}
            />
          </div>

          {/* Chart */}
          <div className="relative" onClick={handleChartClick}>
            <KlineChart
              symbol={item.symbol}
              timeframe={timeframe}
              onChartReady={handleChartReady}
            />
            <DrawingOverlay
              chart={chart}
              candleSeries={candleSeries}
              activeTool={activeTool}
              trendLines={trendLines}
              onAddTrendLine={handleAddTrendLine}
            />
          </div>
        </>
      )}

      {activeTab === 'tags' && (
        <div className="py-2">
          <TagSelector symbol={item.symbol} />
        </div>
      )}

      {activeTab === 'journal' && (
        <div className="space-y-3">
          <JournalEntryComp
            symbol={item.symbol}
            date={selectedDate}
            editingJournal={editingJournal}
            onSaved={handleJournalSaved}
          />
          <JournalListComp
            journals={journals}
            onEdit={setEditingJournal}
            onDelete={handleJournalDelete}
          />
        </div>
      )}
    </div>
  )
}
