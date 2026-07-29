'use client'

import {useState, useEffect, useCallback, useRef} from 'react'
import {
  TrendingUp,
  Search,
  X,
  AlertTriangle,
  Clock,
  DollarSign,
  Target,
  TrendingDown
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import {api} from '@/lib/api'
import {usePositionWs} from '@/hooks/usePositionWs'

function fmt(v: number): string {
  if (v >= 1000) return v.toFixed(2)
  if (v >= 1) return v.toFixed(4)
  return v.toFixed(6)
}
function pnl(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
}
function dateISO(d: string) {
  return new Date(d).toLocaleDateString('zh-CN')
}
function timeISO(d: string) {
  return new Date(d).toLocaleString('zh-CN', {hour12: false})
}
function hold(s: number | null): string {
  if (!s) return '—'
  if (s < 3600) return `${~~(s / 60)}分`
  const h = ~~(s / 3600)
  return h < 24
    ? `${h}小时${~~((s % 3600) / 60)}分`
    : `${~~(h / 24)}天${h % 24}小时`
}

function SideBadge({s}: {s: 'LONG' | 'SHORT'}) {
  return (
    <span
      className={`font-bold text-[11px] ${s === 'LONG' ? 'text-emerald-500' : 'text-red-500'}`}
    >
      {s === 'LONG' ? '多' : '空'}
    </span>
  )
}
function PnlCell({v}: {v: number}) {
  return (
    <span
      className={
        v > 0
          ? 'text-emerald-500'
          : v < 0
            ? 'text-red-500'
            : 'text-muted-foreground'
      }
    >
      {pnl(v)}
    </span>
  )
}
function Card({
  label,
  value,
  icon,
  color
}: {
  label: string
  value: string
  icon: React.ReactNode
  color?: string
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <p className={`text-sm font-bold ${color || ''}`}>{value}</p>
    </div>
  )
}

export default function FuturesPage() {
  const [tab, setTab] = useState('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keys, setKeys] = useState<Array<{id: number; label: string}>>([])
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [openPositions, setOpenPositions] = useState<any[]>([])
  const [history, setHistory] = useState<{
    records: any[]
    total: number
    page: number
  }>({records: [], total: 0, page: 1})
  const [summary, setSummary] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [hisSym, setHisSym] = useState('')
  const today = new Date()
  const d30 = new Date(today)
  d30.setDate(d30.getDate() - 30)
  const [sDate, setSDate] = useState(d30.toISOString().slice(0, 10))
  const [eDate, setEDate] = useState(today.toISOString().slice(0, 10))

  // ─── 竞态安全：跟踪最新的请求 Key，过时响应直接丢弃 ───
  const fetchKeyRef = useRef<number | null>(null)
  // ─── 标记是否已初始化（避免首次 Key 加载覆盖用户切换 + 重复请求） ───
  const initializedRef = useRef(false)
  // ─── 用 ref 保持最新的 loadAll/loadHistory 引用，供 usePositionWs 使用 ───
  const loadAllRef = useRef<() => Promise<void>>(async () => {})
  const loadHistoryRef = useRef<(page?: number) => Promise<void>>(
    async () => {}
  )

  // ─── 首次挂载时拉取 Key 列表，选中第一个 Key（让 useEffect 自动加载数据） ───
  useEffect(() => {
    api
      .listApiKeys()
      .then((rawKeys: any) => {
        const bk = (rawKeys ?? []).filter(
          (k: any) => k.exchange === 'binance' && k.status === 'ACTIVE'
        )
        if (!bk.length) {
          setError('请先绑定 Binance API Key')
          setLoading(false)
          setKeys([])
          return
        }
        const kl = bk.map((k: any) => ({
          id: k.id,
          label: k.label || `Key #${k.id}`
        }))
        setKeys(kl)

        // 只在用户尚未手动选择时才自动选中第一个 Key
        if (!initializedRef.current) {
          initializedRef.current = true
          setSelectedKeyId(kl[0].id)
        }
      })
      .catch((err: Error) => {
        console.error('[futures] 加载 Key 列表失败:', err.message)
        setError('加载 API Key 失败，请检查网络连接')
        setLoading(false)
      })
  }, [])

  // ─── selectedKeyId 变化时加载数据 ───
  const loadAll = useCallback(async () => {
    const kid = selectedKeyId
    if (!kid) return
    // 记录当前请求的 Key，用于后续丢弃过时响应
    fetchKeyRef.current = kid
    setLoading(true)
    setError('')
    try {
      const [pd, sd] = await Promise.all([
        api.getOpenPositions(kid),
        api.getPositionSummary({keyId: kid})
      ])
      // ⚠️ 竞态检查：如果 selectedKeyId 在此期间变了，丢弃本次结果
      if (fetchKeyRef.current !== kid) return
      setOpenPositions((pd as any)[kid]?.openPositions ?? [])
      setSummary(sd)
    } catch (e: any) {
      if (fetchKeyRef.current !== kid) return
      setError(e.message)
    }
    if (fetchKeyRef.current === kid) setLoading(false)
  }, [selectedKeyId])

  const loadHistory = useCallback(
    async (page = 1) => {
      const kid = selectedKeyId
      if (!kid) return
      try {
        const d = await api.getPositionHistory({
          keyId: kid,
          symbol: hisSym || undefined,
          startDate: sDate || undefined,
          endDate: eDate || undefined,
          page,
          pageSize: 50
        })
        // 竞态检查
        if (fetchKeyRef.current !== kid) return
        setHistory(d as any)
      } catch {}
    },
    [selectedKeyId, hisSym, sDate, eDate]
  )

  // ─── 维护 ref 引用，供 WS 回调使用 ───
  loadAllRef.current = loadAll
  loadHistoryRef.current = loadHistory

  usePositionWs(() => {
    loadAllRef.current()
    loadHistoryRef.current()
  }, !!selectedKeyId)

  // ─── selectedKeyId 变化时触发加载 ───
  useEffect(() => {
    if (selectedKeyId) loadAll()
  }, [selectedKeyId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === 'history' && selectedKeyId) loadHistory()
  }, [tab, selectedKeyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = async (id: number) => {
    try {
      const d = await api.getPositionDetail(id)
      setDetail(d)
    } catch {}
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">合约仓位分析</h1>
        </div>
        <div className="flex items-center gap-2">
          {keys.length > 1 &&
            keys.map(k => (
              <button
                key={k.id}
                onClick={() => setSelectedKeyId(k.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap ${k.id === selectedKeyId ? 'bg-primary/15 text-primary font-medium border border-primary/30' : 'bg-muted/50 border border-border text-muted-foreground hover:text-foreground'}`}
              >
                {k.label}
              </button>
            ))}
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 text-sm">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <Card
            label="当前持仓"
            value={summary.totalOpenPositions}
            icon={<TrendingUp className="w-3.5 h-3.5" />}
          />
          <Card
            label="历史平仓"
            value={summary.totalClosedPositions}
            icon={<Clock className="w-3.5 h-3.5" />}
          />
          <Card
            label="总盈亏"
            value={pnl(summary.totalRealizedPnl)}
            color={
              summary.totalRealizedPnl >= 0
                ? 'text-emerald-500'
                : 'text-red-500'
            }
            icon={<DollarSign className="w-3.5 h-3.5" />}
          />
          <Card
            label="胜率"
            value={`${summary.winRate?.toFixed(1)}%`}
            icon={<Target className="w-3.5 h-3.5" />}
          />
          <Card
            label="平均ROI"
            value={`${summary.avgRoiPct?.toFixed(2)}%`}
            color={
              (summary.avgRoiPct ?? 0) >= 0
                ? 'text-emerald-500'
                : 'text-red-500'
            }
            icon={<TrendingUp className="w-3.5 h-3.5" />}
          />
          <Card
            label="强平"
            value={summary.totalLiquidationCount}
            color={summary.totalLiquidationCount > 0 ? 'text-red-500' : ''}
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
          />
        </div>
      )}

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex gap-1 mb-4 border-b border-border">
          {['open' as const, 'history' as const].map(t => (
            <Tabs.Trigger
              key={t}
              value={t}
              className="px-4 py-2 text-sm data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary text-muted-foreground"
            >
              {t === 'open' ? '当前仓位' : '历史仓位'}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="open">
          {loading ? (
            <div className="flex justify-center py-20 text-muted-foreground">
              加载中...
            </div>
          ) : openPositions.length === 0 ? (
            <Empty title="暂无持仓" desc="当前没有持有中的合约仓位" />
          ) : (
            <Table
              headers={[
                '币对',
                '方向',
                '数量',
                '开仓价',
                '标记价',
                '未实现盈亏',
                'ROI',
                '强平价',
                '杠杆',
                '保证金'
              ]}
            >
              {openPositions.map((p: any, i: number) => {
                const roi =
                  p.entryPrice > 0
                    ? ((p.markPrice - p.entryPrice) / p.entryPrice) *
                      100 *
                      (p.positionSide === 'LONG' ? 1 : -1)
                    : 0
                return (
                  <tr
                    key={i}
                    className="border-t border-border hover:bg-muted/30"
                  >
                    <td className="px-3 py-2.5 font-medium">
                      {p.symbol?.replace('USDT', '/USDT')}
                    </td>
                    <td className="px-3 py-2.5">
                      <SideBadge s={p.positionSide || 'LONG'} />
                    </td>
                    <td className="px-3 py-2.5">{p.quantity?.toFixed(3)}</td>
                    <td className="px-3 py-2.5">{fmt(p.entryPrice)}</td>
                    <td className="px-3 py-2.5">{fmt(p.markPrice)}</td>
                    <td className="px-3 py-2.5">
                      <PnlCell v={p.unrealizedPnl} />
                    </td>
                    <td
                      className={`px-3 py-2.5 ${roi >= 0 ? 'text-emerald-500' : 'text-red-500'}`}
                    >
                      {roi >= 0 ? '+' : ''}
                      {roi.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {fmt(p.liquidationPrice)}
                    </td>
                    <td className="px-3 py-2.5">{p.leverage}x</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] px-1 py-0.5 rounded bg-muted/50">
                        {p.marginType === 'isolated' ? '逐仓' : '全仓'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </Table>
          )}
        </Tabs.Content>

        <Tabs.Content value="history">
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="币对"
                value={hisSym}
                onChange={e => setHisSym(e.target.value.toUpperCase())}
                className="w-32 pl-7 pr-2 py-1.5 rounded-lg bg-muted/50 border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <input
              type="date"
              value={sDate}
              onChange={e => setSDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-muted/50 border border-border text-sm scheme-dark"
            />
            <span className="text-muted-foreground self-center text-sm">—</span>
            <input
              type="date"
              value={eDate}
              onChange={e => setEDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-muted/50 border border-border text-sm scheme-dark"
            />
            <button
              onClick={() => loadHistory()}
              className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm hover:bg-primary/20"
            >
              查询
            </button>
          </div>
          {history.records.length === 0 ? (
            <Empty
              title="暂无历史仓位"
              desc="绑定 API Key 后自动同步近 30 天数据"
            />
          ) : (
            <>
              <Table
                headers={[
                  '币对',
                  '方向',
                  '数量',
                  '开仓价',
                  '平仓价',
                  '净盈亏',
                  'ROI',
                  '回撤',
                  '持仓时间',
                  '强平',
                  '操作'
                ]}
              >
                {history.records.map((p: any) => {
                  const net = (p.realizedPnl ?? 0) - (p.totalFee ?? 0)
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-border hover:bg-muted/30"
                    >
                      <td className="px-3 py-2.5 font-medium">
                        {p.symbol?.replace('USDT', '/USDT')}
                      </td>
                      <td className="px-3 py-2.5">
                        <SideBadge s={p.positionSide} />
                      </td>
                      <td className="px-3 py-2.5">{p.quantity?.toFixed(3)}</td>
                      <td className="px-3 py-2.5">{fmt(p.entryPrice)}</td>
                      <td className="px-3 py-2.5">
                        {p.exitPrice ? fmt(p.exitPrice) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <PnlCell v={net} />
                      </td>
                      <td
                        className={`px-3 py-2.5 ${(p.roiPct ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}
                      >
                        {(p.roiPct ?? 0) >= 0 ? '+' : ''}
                        {(p.roiPct ?? 0).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5">
                        {p.maxDrawdownPct != null
                          ? `${p.maxDrawdownPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-muted-foreground">
                        {hold(p.holdingSeconds)}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.isLiquidation ? (
                          <span className="text-red-500 text-[11px] flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            强平
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => openDetail(p.id)}
                          className="text-primary hover:underline text-[12px]"
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </Table>
              {history.total > 50 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    disabled={history.page <= 1}
                    onClick={() => loadHistory(history.page - 1)}
                    className="px-3 py-1 rounded border border-border text-sm disabled:opacity-30"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {history.page} / {Math.ceil(history.total / 50)}
                  </span>
                  <button
                    disabled={history.page >= Math.ceil(history.total / 50)}
                    onClick={() => loadHistory(history.page + 1)}
                    className="px-3 py-1 rounded border border-border text-sm disabled:opacity-30"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>

      {/* Detail Modal */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">
                  {detail.symbol?.replace('USDT', '/USDT')}
                </h2>
                <SideBadge s={detail.positionSide} />
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full ${detail.status === 'OPEN' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}
                >
                  {detail.status === 'OPEN' ? '持仓中' : '已平仓'}
                </span>
                {detail.isLiquidation && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    强平
                  </span>
                )}
              </div>
              <button
                onClick={() => setDetail(null)}
                className="p-1 hover:bg-muted rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
              <Card2
                title="净盈亏"
                value={`${detail.analysis?.netPnl >= 0 ? '+' : ''}${detail.analysis?.netPnl?.toFixed(2)} USDT`}
                color={
                  detail.analysis?.netPnl >= 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
                }
                icon={<DollarSign className="w-4 h-4" />}
              />
              <Card2
                title="收益率"
                value={`${detail.analysis?.roiPct >= 0 ? '+' : ''}${detail.analysis?.roiPct?.toFixed(2)}%`}
                color={
                  detail.analysis?.roiPct >= 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
                }
                icon={<TrendingUp className="w-4 h-4" />}
              />
              <Card2
                title="最大回撤"
                value={`${detail.analysis?.maxDrawdownPct?.toFixed(2)}%`}
                color="text-red-500"
                icon={<TrendingDown className="w-4 h-4" />}
              />
              <Card2
                title="持仓时间"
                value={detail.analysis?.holdingTimeFormatted}
                icon={<Clock className="w-4 h-4" />}
              />
            </div>
            <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">开仓均价</span>
                <p className="font-medium">{fmt(detail.entryPrice)}</p>
                {detail.orderSummary?.entryCount > 1 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {detail.orderSummary.entryCount} 笔合并 · 均价{' '}
                    {fmt(detail.orderSummary.entryAvgPrice)}
                  </p>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">平仓均价</span>
                <p className="font-medium">
                  {detail.exitPrice ? fmt(detail.exitPrice) : '—'}
                </p>
                {detail.orderSummary?.exitCount > 1 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {detail.orderSummary.exitCount} 笔合并 · 均价{' '}
                    {fmt(detail.orderSummary.exitAvgPrice)}
                  </p>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">数量</span>
                <p className="font-medium">{detail.quantity?.toFixed(4)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">手续费</span>
                <p className="font-medium">
                  {detail.totalFee?.toFixed(4)} USDT
                </p>
              </div>
            </div>
            <div className="px-4 pb-4">
              <h3 className="text-sm font-medium mb-2 text-muted-foreground">
                成交明细
                {detail.orderSummary && (
                  <span className="text-[11px] ml-2">
                    ({detail.orderSummary.entryCount} 笔开仓 ·{' '}
                    {detail.orderSummary.exitCount} 笔平仓)
                  </span>
                )}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2.5 py-2">时间</th>
                      <th className="px-2.5 py-2">方向</th>
                      <th className="px-2.5 py-2">价格</th>
                      <th className="px-2.5 py-2">数量</th>
                      <th className="px-2.5 py-2">盈亏</th>
                      <th className="px-2.5 py-2">手续费</th>
                      <th className="px-2.5 py-2">标记</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.orders ?? []).map((o: any, i: number) => {
                      const isOpen =
                        o.side === 'OPEN_LONG' || o.side === 'OPEN_SHORT'
                      const lb =
                        o.side === 'OPEN_LONG'
                          ? '开多'
                          : o.side === 'CLOSE_LONG'
                            ? '平多'
                            : o.side === 'OPEN_SHORT'
                              ? '开空'
                              : '平空'
                      return (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2.5 py-2 text-muted-foreground">
                            {timeISO(o.executedAt)}
                          </td>
                          <td
                            className={`px-2.5 py-2 ${o.side?.includes('LONG') ? (isOpen ? 'text-emerald-500' : 'text-red-500') : isOpen ? 'text-red-500' : 'text-emerald-500'}`}
                          >
                            {lb}
                          </td>
                          <td className="px-2.5 py-2">{fmt(o.price)}</td>
                          <td className="px-2.5 py-2">
                            {o.amount?.toFixed(4)}
                          </td>
                          <td className="px-2.5 py-2">
                            <PnlCell v={o.realizedPnl ?? 0} />
                          </td>
                          <td className="px-2.5 py-2 text-muted-foreground">
                            {(o.feeUsdt ?? 0).toFixed(4)}
                          </td>
                          <td className="px-2.5 py-2">
                            {o.isLiquidation && (
                              <span className="text-red-500 flex items-center gap-0.5">
                                <AlertTriangle className="w-3 h-3" />
                                强平
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-6 text-xs text-muted-foreground">
              <span>开仓: {timeISO(detail.openedAt)}</span>
              {detail.closedAt && <span>平仓: {timeISO(detail.closedAt)}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Table({
  headers,
  children
}: {
  headers: string[]
  children: React.ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="text-left text-muted-foreground">
            {headers.map(h => (
              <th key={h} className="px-3 py-2.5 font-medium text-xs">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
function Empty({title, desc}: {title: string; desc: string}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <TrendingUp className="w-12 h-12 mb-4 opacity-20" />
      <p className="text-base font-medium mb-1">{title}</p>
      <p className="text-sm">{desc}</p>
    </div>
  )
}
function Card2({
  title,
  value,
  color,
  icon
}: {
  title: string
  value: string
  color?: string
  icon: React.ReactNode
}) {
  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
        {icon}
        <span className="text-xs">{title}</span>
      </div>
      <p className={`text-base font-bold ${color || ''}`}>{value}</p>
    </div>
  )
}
