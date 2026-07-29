'use client'

import {useState, useEffect, useCallback} from 'react'
import {
  Search,
  Users,
  UserPlus,
  UserMinus,
  Eye,
  EyeOff,
  Globe,
  DollarSign,
  Loader2,
  Activity,
  User as UserIcon
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import {api, getStoredUser} from '@/lib/api'

function fmtPct(v: number): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function PnlText({v}: {v: number}) {
  if (v == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={v >= 0 ? 'text-emerald-500' : 'text-red-500'}>
      {fmtPct(v)}
    </span>
  )
}

// ─── 搜索公开用户 ───
function UserSearch({onFollowChange}: {onFollowChange: () => void}) {
  const [keyword, setKeyword] = useState('')
  const [users, setUsers] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  useEffect(() => {
    const u = getStoredUser()
    if (u) setCurrentUserId(u.id)
  }, [])

  const search = useCallback(
    async (page = 1) => {
      setLoading(true)
      try {
        const res = await api.searchPublicUsers({
          q: keyword || undefined,
          page,
          pageSize: 50
        })
        setUsers(res.users ?? [])
        setTotal(res.total ?? 0)
      } catch {}
      setLoading(false)
    },
    [keyword]
  )

  useEffect(() => {
    search()
  }, [search])

  const handleFollow = async (userId: number) => {
    try {
      await api.followUser(userId)
      setUsers(prev =>
        prev.map(u => (u.id === userId ? {...u, isFollowing: true} : u))
      )
      onFollowChange()
    } catch {}
  }

  const handleUnfollow = async (userId: number) => {
    try {
      await api.unfollowUser(userId)
      setUsers(prev =>
        prev.map(u => (u.id === userId ? {...u, isFollowing: false} : u))
      )
      onFollowChange()
    } catch {}
  }

  return (
    <div>
      {/* 搜索框 */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="搜索用户名..."
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-muted/50 border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Users className="w-12 h-12 mb-3 opacity-20" />
          <p className="text-sm">暂无公开用户</p>
          <p className="text-xs mt-1">
            {keyword ? '换个关键词试试' : '还没有用户开启公开'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u: any) => (
            <UserCard
              key={u.id}
              user={u}
              isSelf={currentUserId === u.id}
              onFollow={() => handleFollow(u.id)}
              onUnfollow={() => handleUnfollow(u.id)}
            />
          ))}
        </div>
      )}

      {total > 50 && (
        <div className="flex justify-center mt-4 text-xs text-muted-foreground">
          共 {total} 人
        </div>
      )}
    </div>
  )
}

// ─── 用户卡片 ───
function UserCard({
  user,
  isSelf,
  onFollow,
  onUnfollow
}: {
  user: any
  isSelf: boolean
  onFollow: () => void
  onUnfollow: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [userData, setUserData] = useState<any>(null)
  const [loadingData, setLoadingData] = useState(false)

  const loadUserData = async () => {
    if (userData) return
    setLoadingData(true)
    try {
      const data = await api.getPublicUserData(user.id)
      setUserData(data)
    } catch {}
    setLoadingData(false)
  }

  const handleToggle = () => {
    if (!expanded) {
      loadUserData()
    }
    setExpanded(!expanded)
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden transition-all hover:border-muted-foreground/30">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 sm:p-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-primary">
              {user.username[0]?.toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {user.username}
              </span>
              {user.settings?.isPublic && (
                <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
              {user.openPositionCount != null && (
                <span>{user.openPositionCount} 持仓</span>
              )}
              {user.settings?.showPositions && (
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  公开持仓
                </span>
              )}
              {user.settings?.showCapital && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  公开资金
                </span>
              )}
              {user.settings?.showOrders && (
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  公开订单
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isSelf ? (
            <span className="flex items-center gap-1 text-xs px-2.5 py-1.5 text-muted-foreground">
              <UserIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">自己</span>
            </span>
          ) : user.isFollowing ? (
            <button
              onClick={onUnfollow}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <UserMinus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">已关注</span>
            </button>
          ) : (
            <button
              onClick={onFollow}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">关注</span>
            </button>
          )}
          <button
            onClick={handleToggle}
            className="text-xs px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            {expanded ? '收起' : '查看'}
          </button>
        </div>
      </div>

      {/* 展开详情 - 按需拉取 */}
      {expanded && (
        <div className="border-t border-border px-3 sm:px-4 py-3">
          {loadingData ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : userData ? (
            <div className="space-y-3">
              {/* 公开资金 */}
              {userData.capital && (
                <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <span className="text-xs text-muted-foreground">
                      总资产
                    </span>
                    <p className="text-sm font-bold">
                      ${userData.capital.totalNetVal?.toFixed(2) ?? '—'}
                    </p>
                  </div>
                </div>
              )}

              {/* 公开持仓 */}
              {userData.positions && userData.positions.length > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    当前持仓 ({userData.positions.length})
                  </p>
                  <div className="space-y-1">
                    {userData.positions.map((p: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/30 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {p.symbol?.replace('USDT', '/USDT')}
                          </span>
                          <span
                            className={`text-[11px] font-bold ${
                              p.positionSide === 'LONG'
                                ? 'text-emerald-500'
                                : 'text-red-500'
                            }`}
                          >
                            {p.positionSide === 'LONG' ? '多' : '空'}
                          </span>
                        </div>
                        <PnlText v={p.roiPct} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : userData.positions && userData.positions.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <EyeOff className="w-3.5 h-3.5" />
                  当前无公开持仓
                </div>
              ) : null}

              {/* 公开订单历史 */}
              {userData.trades && userData.trades.length > 0 && (
                <div className="border-t border-border pt-3 mt-2">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    最近成交 ({userData.trades.length})
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {userData.trades.map((t: any, i: number) => {
                      const isOpen =
                        t.side === 'OPEN_LONG' || t.side === 'OPEN_SHORT'
                      const isLong =
                        t.side === 'OPEN_LONG' || t.side === 'CLOSE_LONG'
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1 px-2 rounded text-xs hover:bg-muted/30"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">
                              {t.symbol?.replace('USDT', '/USDT')}
                            </span>
                            <span
                              className={`text-[10px] font-bold shrink-0 ${
                                isLong ? 'text-emerald-500' : 'text-red-500'
                              }`}
                            >
                              {isOpen
                                ? isLong
                                  ? '开多'
                                  : '开空'
                                : isLong
                                  ? '平多'
                                  : '平空'}
                            </span>
                          </div>
                          <span
                            className={`shrink-0 ml-2 ${
                              (t.realizedPnl ?? 0) > 0
                                ? 'text-emerald-500'
                                : (t.realizedPnl ?? 0) < 0
                                  ? 'text-red-500'
                                  : 'text-muted-foreground'
                            }`}
                          >
                            {(t.realizedPnl ?? 0) >= 0 ? '+' : ''}
                            {t.realizedPnl?.toFixed(2)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {!userData.capital &&
                (!userData.positions || userData.positions.length === 0) &&
                (!userData.trades || userData.trades.length === 0) && (
                  <div className="text-xs text-muted-foreground py-2">
                    暂无公开数据
                  </div>
                )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2">
              该用户暂无公开数据
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 已关注列表 ───
function FollowingList({refreshKey}: {refreshKey: number}) {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getMyFollowing()
      setList(data ?? [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Users className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm">还没有关注任何人</p>
        <p className="text-xs mt-1">去"全部用户"发现公开的交易者</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {list.map((item: any) => (
        <FollowingCard key={item.id} item={item} onUnfollow={load} />
      ))}
    </div>
  )
}

function FollowingCard({
  item,
  onUnfollow
}: {
  item: any
  onUnfollow: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [userData, setUserData] = useState<any>(null)
  const [loadingData, setLoadingData] = useState(false)

  const loadUserData = async () => {
    if (userData) return
    setLoadingData(true)
    try {
      const data = await api.getPublicUserData(item.followingId)
      setUserData(data)
    } catch {}
    setLoadingData(false)
  }

  const handleToggle = () => {
    if (!expanded) {
      loadUserData()
    }
    setExpanded(!expanded)
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden transition-all hover:border-muted-foreground/30">
      <div className="flex items-center justify-between p-3 sm:p-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-primary">
              {item.username[0]?.toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium truncate">
              {item.username}
            </span>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
              <span>{item.openPositionCount} 持仓</span>
              {item.settings?.showCapital && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  公开资金
                </span>
              )}
              {item.settings?.showOrders && (
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  公开订单
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onUnfollow}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/30 transition-colors"
          >
            <UserMinus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">取消关注</span>
          </button>
          <button
            onClick={handleToggle}
            className="text-xs px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            {expanded ? '收起' : '查看'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 sm:px-4 py-3">
          {loadingData ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : userData ? (
            <div className="space-y-3">
              {userData.capital && (
                <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <span className="text-xs text-muted-foreground">
                      总资产
                    </span>
                    <p className="text-sm font-bold">
                      ${userData.capital.totalNetVal?.toFixed(2) ?? '—'}
                    </p>
                  </div>
                </div>
              )}

              {userData.positions && userData.positions.length > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    当前持仓 ({userData.positions.length})
                  </p>
                  <div className="space-y-1">
                    {userData.positions.map((p: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/30 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {p.symbol?.replace('USDT', '/USDT')}
                          </span>
                          <span
                            className={`text-[11px] font-bold ${
                              p.positionSide === 'LONG'
                                ? 'text-emerald-500'
                                : 'text-red-500'
                            }`}
                          >
                            {p.positionSide === 'LONG' ? '多' : '空'}
                          </span>
                        </div>
                        <PnlText v={p.roiPct} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-2">
                  暂无公开持仓
                </div>
              )}

              {/* 公开订单历史 */}
              {userData.trades && userData.trades.length > 0 && (
                <div className="border-t border-border pt-3 mt-2">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    最近成交 ({userData.trades.length})
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {userData.trades.map((t: any, i: number) => {
                      const isOpen =
                        t.side === 'OPEN_LONG' || t.side === 'OPEN_SHORT'
                      const isLong =
                        t.side === 'OPEN_LONG' || t.side === 'CLOSE_LONG'
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1 px-2 rounded text-xs hover:bg-muted/30"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">
                              {t.symbol?.replace('USDT', '/USDT')}
                            </span>
                            <span
                              className={`text-[10px] font-bold shrink-0 ${
                                isLong ? 'text-emerald-500' : 'text-red-500'
                              }`}
                            >
                              {isOpen
                                ? isLong
                                  ? '开多'
                                  : '开空'
                                : isLong
                                  ? '平多'
                                  : '平空'}
                            </span>
                          </div>
                          <span
                            className={`shrink-0 ml-2 ${
                              (t.realizedPnl ?? 0) > 0
                                ? 'text-emerald-500'
                                : (t.realizedPnl ?? 0) < 0
                                  ? 'text-red-500'
                                  : 'text-muted-foreground'
                            }`}
                          >
                            {(t.realizedPnl ?? 0) >= 0 ? '+' : ''}
                            {t.realizedPnl?.toFixed(2)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {!userData.capital &&
                (!userData.positions || userData.positions.length === 0) &&
                (!userData.trades || userData.trades.length === 0) && (
                  <div className="text-xs text-muted-foreground py-2">
                    暂无公开数据
                  </div>
                )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2">
              暂无公开数据
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════
// 主页面
// ══════════════════════════════════════════
export default function AnalysisPage() {
  const [tab, setTab] = useState('explore')
  const [refreshKey, setRefreshKey] = useState(0)

  const handleFollowChange = () => {
    setRefreshKey(prev => prev + 1)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Activity className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">实盘订阅</h1>
      </div>

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex gap-1 mb-4 border-b border-border">
          <Tabs.Trigger
            value="explore"
            className="px-4 py-2 text-sm data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary text-muted-foreground transition-colors"
          >
            全部用户
          </Tabs.Trigger>
          <Tabs.Trigger
            value="following"
            className="px-4 py-2 text-sm data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary text-muted-foreground transition-colors"
          >
            已订阅
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="explore">
          <UserSearch onFollowChange={handleFollowChange} />
        </Tabs.Content>

        <Tabs.Content value="following">
          <FollowingList refreshKey={refreshKey} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
