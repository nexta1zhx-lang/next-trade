'use client'

import {useState, useEffect, useCallback} from 'react'
import {Activity, Cpu, HardDrive, Network, Wifi} from 'lucide-react'
import {API_ORIGIN} from '@/lib/api'

function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${mb.toFixed(0)}MB`
}

export default function MonitorPage() {
  const [now, setNow] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [hours, setHours] = useState(24)
  const [loading, setLoading] = useState(true)

  const fetchNow = useCallback(async () => {
    try {
      const res = await fetch(`${API_ORIGIN}/api/monitor/now`)
      const json = await res.json()
      if (json.success) setNow(json.data)
    } catch {}
  }, [])

  const fetchHistory = useCallback(async (h: number) => {
    setLoading(true)
    try {
      const res = await fetch(`${API_ORIGIN}/api/monitor/history?hours=${h}`)
      const json = await res.json()
      if (json.success) setHistory(json.data ?? [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchNow()
    fetchHistory(hours)
    const timer = setInterval(fetchNow, 5000)
    return () => clearInterval(timer)
  }, [fetchNow, fetchHistory, hours])

  const pctColor = (v: number) =>
    v > 80 ? 'text-red-400' : v > 50 ? 'text-yellow-400' : 'text-emerald-400'

  const bar = (v: number) => {
    const w = Math.min(v, 100)
    const color = v > 80 ? 'bg-red-500' : v > 50 ? 'bg-yellow-500' : 'bg-emerald-500'
    return (
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-1000 ${color}`} style={{width: `${w}%`}} />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-2 sm:px-4 lg:px-6 py-3 sm:py-6">
      <div className="flex items-center gap-2 mb-6">
        <Activity className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-base sm:text-lg font-semibold">服务器监控</h1>
        {now && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {new Date().toLocaleTimeString('zh-CN')}
          </span>
        )}
      </div>

      {/* 实时指标卡片 */}
      {now && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Cpu className="w-4 h-4" />
              <span className="text-xs">CPU</span>
            </div>
            <p className={`text-lg font-bold ${pctColor(now.cpuPercent)}`}>
              {now.cpuPercent.toFixed(1)}%
            </p>
            {bar(now.cpuPercent)}
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Activity className="w-4 h-4" />
              <span className="text-xs">内存</span>
            </div>
            <p className={`text-lg font-bold ${pctColor(now.memPercent)}`}>
              {now.memPercent.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {fmtMb(now.memUsedMb)} / {fmtMb(now.memTotalMb)}
            </p>
            {bar(now.memPercent)}
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <HardDrive className="w-4 h-4" />
              <span className="text-xs">磁盘</span>
            </div>
            <p className={`text-lg font-bold ${pctColor(now.diskPercent)}`}>
              {now.diskPercent.toFixed(1)}%
            </p>
            {bar(now.diskPercent)}
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Network className="w-4 h-4" />
              <span className="text-xs">Swap</span>
            </div>
            <p className={`text-lg font-bold ${pctColor(now.swapPercent)}`}>
              {now.swapPercent.toFixed(1)}%
            </p>
            {bar(now.swapPercent)}
          </div>
        </div>
      )}

      {/* 时间选择 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground">历史:</span>
        {[1, 6, 24, 168].map(h => (
          <button
            key={h}
            onClick={() => { setHours(h); fetchHistory(h) }}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
              hours === h ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground bg-card border border-border'
            }`}
          >
            {h >= 24 ? `${h / 24}d` : `${h}h`}
          </button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {loading ? '加载中...' : `${history.length} 条记录`}
        </span>
      </div>

      {/* 历史折线图 */}
      {history.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <LineChart data={history} label="CPU 使用率" field="cpuPercent" color="#3b82f6" unit="%" />
          <LineChart data={history} label="内存使用率" field="memPercent" color="#22c55e" unit="%" />
          <LineChart data={history} label="磁盘使用率" field="diskPercent" color="#f59e0b" unit="%" />
          <LineChart data={history} label="Swap 使用率" field="swapPercent" color="#ef4444" unit="%" />
        </div>
      )}

      {!now && !loading && (
        <div className="text-center text-muted-foreground py-20">
          <Wifi className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">无法获取监控数据</p>
          <p className="text-xs mt-1">请确认服务器已安装 Node Exporter</p>
        </div>
      )}
    </div>
  )
}

/** 纯 CSS 折线图组件（无第三方依赖） */
function LineChart({data, label, field, color, unit}: {
  data: any[]
  label: string
  field: string
  color: string
  unit: string
}) {
  const values = data.map(d => d[field])
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 600
  const h = 120
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')

  const latest = values[values.length - 1]
  const avg = values.reduce((a, b) => a + b, 0) / values.length

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: color}} />
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          当前 {latest?.toFixed(1)}{unit} / 均 {avg?.toFixed(1)}{unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="none">
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
      </svg>
    </div>
  )
}
