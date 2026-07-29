'use client'

import {useState, useEffect, useCallback, useRef} from 'react'
import {Activity, Cpu, HardDrive, MemoryStick, Wifi, Container, Server} from 'lucide-react'
import {API_ORIGIN} from '@/lib/api'

function fmtSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${mb.toFixed(0)}MB`
}
function pct(v: number): string {
  return `${v.toFixed(1)}%`
}

export default function MonitorPage() {
  const [now, setNow] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [docker, setDocker] = useState<any[]>([])
  const [hours, setHours] = useState(24)
  const [loading, setLoading] = useState(true)

  const fetchNow = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${API_ORIGIN}/api/monitor/now`).then(r => r.json()),
        fetch(`${API_ORIGIN}/api/monitor/docker`).then(r => r.json())
      ])
      if (r1.success) setNow(r1.data)
      if (r2.success) setDocker(r2.data ?? [])
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

  const Card = ({icon, label, value, sub, color, barVal}: any) => (
    <div className="bg-card border border-border rounded-xl p-4 touch-manipulation select-none">
      <div className="flex items-center gap-2 text-muted-foreground mb-2 text-xs">
        {icon}<span>{label}</span>
      </div>
      <p className={`text-lg font-bold ${color ?? ''}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      {barVal != null && (
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mt-1">
          <div className={`h-full rounded-full ${barVal > 80 ? 'bg-red-500' : barVal > 50 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
            style={{width: `${Math.min(barVal, 100)}%`}} />
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto px-2 sm:px-4 lg:px-6 py-3 sm:py-6">
      <div className="flex items-center gap-2 mb-6">
        <Server className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-base sm:text-lg font-semibold">服务器监控</h1>
        {now && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {new Date().toLocaleTimeString('zh-CN')}
          </span>
        )}
      </div>

      {now && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-6">
            <Card icon={<Cpu className="w-4 h-4" />} label="CPU" value={pct(now.cpuPercent)} color={pctColor(now.cpuPercent)} barVal={now.cpuPercent} />
            <Card icon={<MemoryStick className="w-4 h-4" />} label="内存" value={pct(now.memPercent)} color={pctColor(now.memPercent)}
              sub={`${fmtSize(now.memUsedMb)} / ${fmtSize(now.memTotalMb)}`} barVal={now.memPercent} />
            <Card icon={<HardDrive className="w-4 h-4" />} label="磁盘" value={now.diskUsedGb ? `${fmtSize(now.diskUsedGb * 1024)} / ${fmtSize(now.diskTotalGb * 1024)}` : pct(now.diskPercent)}
              color={pctColor(now.diskPercent)} sub={pct(now.diskPercent)} barVal={now.diskPercent} />
            <Card icon={<Activity className="w-4 h-4" />} label="Swap" value={pct(now.swapPercent)} color={pctColor(now.swapPercent)} barVal={now.swapPercent} />
          </div>

          {docker.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4 mb-6">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Container className="w-4 h-4" />
                <span>Docker 容器 ({docker.length})</span>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5 pr-3">容器</th>
                      <th className="text-right px-2">CPU</th>
                      <th className="text-right px-2">内存</th>
                      <th className="text-right pl-2">进程</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docker.map((d: any, i: number) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-1.5 pr-3 font-medium truncate max-w-[120px]">{d.name}</td>
                        <td className={`text-right px-2 ${pctColor(d.cpuPercent)}`}>{pct(d.cpuPercent)}</td>
                        <td className={`text-right px-2 ${pctColor(d.memPercent)}`}>
                          {fmtSize(d.memUsage)}<span className="text-muted-foreground"> / {fmtSize(d.memLimit)}</span>
                        </td>
                        <td className="text-right pl-2 text-muted-foreground">{d.pids}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground">历史:</span>
        {[1, 6, 24, 168].map(h => (
          <button key={h} onClick={() => { setHours(h); fetchHistory(h) }}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
              hours === h ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground bg-card border border-border'
            }`}>
            {h >= 24 ? `${h / 24}d` : `${h}h`}
          </button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {loading ? '加载中...' : `${history.length} 条`}
        </span>
      </div>

      {history.length > 0 && (
        <div className="space-y-3">
          <MiniChart data={history} label="CPU 使用率" field="cpuPercent" color="#3b82f6" unit="%" />
          <MiniChart data={history} label="内存使用率" field="memPercent" color="#22c55e" unit="%" />
          <MiniChart data={history} label="磁盘使用率" field="diskPercent" color="#f59e0b" unit="%" />
        </div>
      )}

      {!now && !loading && (
        <div className="text-center text-muted-foreground py-20">
          <Wifi className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">无法获取监控数据</p>
        </div>
      )}
    </div>
  )
}

function MiniChart({data, label, field, color, unit}: {
  data: any[]; label: string; field: string; color: string; unit: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{x: number; v: number} | null>(null)
  const values = data.map((d: any) => d[field])
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 600; const h = 100
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const latest = values[values.length - 1]
  const avg = values.reduce((a, b) => a + b, 0) / values.length

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const x = clientX - rect.left
    const idx = Math.round((x / rect.width) * (values.length - 1))
    if (idx >= 0 && idx < values.length) setTooltip({x, v: values[idx]})
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4"
      ref={ref} onMouseMove={handleMove} onTouchMove={handleMove}
      onMouseLeave={() => setTooltip(null)} onTouchEnd={() => setTooltip(null)}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-foreground flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: color}} />
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          当前 {latest?.toFixed(1)}{unit} / 均 {avg?.toFixed(1)}{unit}
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20 touch-none" preserveAspectRatio="none">
          <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        </svg>
        {tooltip && (
          <div className="absolute -translate-x-1/2 -translate-y-full pointer-events-none z-10"
            style={{left: tooltip.x, top: 0}}>
            <div className="bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
              {tooltip.v.toFixed(1)}{unit}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
