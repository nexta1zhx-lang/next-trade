'use client'

import {useCallback, useEffect, useState} from 'react'
import {
  Key,
  Plus,
  AlertCircle,
  LogIn,
  UserPlus,
  LogOut,
  Trash2,
  Edit3,
  Play,
  Pause
} from 'lucide-react'
import {api, getStoredUser, clearStoredUser} from '@/lib/api'
import type {AuthUser, StoredApiKey} from '@nexttrade/shared'

// ─── 交易所图标 ───
function ExchangeIcon({
  exchange,
  size = 16
}: {
  exchange: string
  size?: number
}) {
  const props = {width: size, height: size, viewBox: '0 0 32 32'}
  switch (exchange) {
    case 'binance':
      return (
        <svg {...props} fill="none">
          <circle cx="16" cy="16" r="15" fill="#F3BA2F" />
          <path
            d="M10.85 14.27L16 9.12l5.15 5.15 3-3L16 3.17l-8.15 8.1 3 3ZM6.17 16l3-3 3 3-3 3-3-3Zm10.3 5.15l-3-3-3 3 3 3 3-3Zm4.68-2.15-3-3 3-3 3 3-3 3Zm-5.15-3L16 14.27l1.73 1.73-1.73 1.73-1.73-1.73Z"
            fill="#fff"
          />
        </svg>
      )
    case 'okx':
      return (
        <svg {...props} fill="none">
          <rect x="1" y="1" width="30" height="30" rx="6" fill="#000" />
          <path d="M8 12h5v8H8v-8Zm6-3h5v14h-5V9Zm6 6h5v5h-5v-5Z" fill="#fff" />
        </svg>
      )
    case 'bybit':
      return (
        <svg {...props} fill="none">
          <rect x="1" y="1" width="30" height="30" rx="6" fill="#F7A600" />
          <text
            x="16"
            y="22"
            textAnchor="middle"
            fontSize="16"
            fontWeight="bold"
            fill="#000"
          >
            B
          </text>
        </svg>
      )
    case 'bitget':
      return (
        <svg {...props} fill="none">
          <rect x="1" y="1" width="30" height="30" rx="6" fill="#1E6DF2" />
          <text
            x="16"
            y="22"
            textAnchor="middle"
            fontSize="14"
            fontWeight="bold"
            fill="#fff"
          >
            Bg
          </text>
        </svg>
      )
    case 'gate':
      return (
        <svg {...props} fill="none">
          <rect x="1" y="1" width="30" height="30" rx="6" fill="#1F2329" />
          <text
            x="16"
            y="22"
            textAnchor="middle"
            fontSize="14"
            fontWeight="bold"
            fill="#fff"
          >
            GT
          </text>
        </svg>
      )
    case 'mexc':
      return (
        <svg {...props} fill="none">
          <rect x="1" y="1" width="30" height="30" rx="6" fill="#00B4E6" />
          <text
            x="16"
            y="22"
            textAnchor="middle"
            fontSize="14"
            fontWeight="bold"
            fill="#fff"
          >
            MX
          </text>
        </svg>
      )
    default:
      return (
        <span
          className="inline-flex items-center justify-center rounded bg-gray-700"
          style={{width: size, height: size, fontSize: size * 0.6}}
        >
          {exchange[0]?.toUpperCase()}
        </span>
      )
  }
}

// ─── 交易所选择列表 ───
const EXCHANGE_OPTIONS = [
  {value: 'binance', label: 'Binance'},
  {value: 'okx', label: 'OKX'},
  {value: 'bybit', label: 'Bybit'},
  {value: 'bitget', label: 'Bitget'},
  {value: 'gate', label: 'Gate.io'},
  {value: 'mexc', label: 'MEXC'}
] as const

// ─── 状态徽章 ───
function StatusBadge({status}: {status: string}) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    PAUSED: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    INVALID: 'bg-red-500/10 text-red-400 border-red-500/30'
  }
  const labels: Record<string, string> = {
    ACTIVE: '同步中',
    PAUSED: '已暂停',
    INVALID: '已失效'
  }
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full border ${colors[status] ?? colors.INVALID}`}
    >
      {labels[status] ?? status}
    </span>
  )
}

// ─── 时间格式化 ───
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60000) return '刚刚'
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} 分钟前`
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)} 小时前`
  return d.toLocaleDateString('zh-CN')
}

// ══════════════════════════════════════════
// 登录/注册
// ══════════════════════════════════════════

function AuthForm({onAuth}: {onAuth: () => void}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (mode === 'register') await api.register(username, password)
      else await api.login(username, password)
      onAuth()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-20">
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-6">
          {mode === 'login' ? (
            <LogIn className="w-6 h-6 text-primary" />
          ) : (
            <UserPlus className="w-6 h-6 text-primary" />
          )}
          <h2 className="text-lg font-semibold">
            {mode === 'login' ? '登录' : '注册'}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:border-primary transition-colors"
            minLength={3}
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:border-primary transition-colors"
            minLength={6}
            required
          />
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium
                       hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        <p className="mt-4 text-xs text-center text-muted-foreground">
          {mode === 'login' ? '没有账号？' : '已有账号？'}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className="text-primary hover:underline ml-1"
          >
            {mode === 'login' ? '注册' : '登录'}
          </button>
        </p>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════
// 主页面
// ══════════════════════════════════════════

export default function OrdersPage() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // ─── API Key 管理状态 ───
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([])
  const [showAddKey, setShowAddKey] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyEx, setNewKeyEx] = useState('binance')
  const [newKey, setNewKey] = useState('')
  const [newSecret, setNewSecret] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(false)

  // ─── 编辑状态 ───
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')

  // ─── 初始化 ───
  useEffect(() => {
    const stored = getStoredUser()
    setUser(stored)
    if (stored) loadKeys()
    setLoading(false)
  }, [])

  const handleAuth = useCallback(() => {
    const stored = getStoredUser()
    setUser(stored)
    if (stored) loadKeys()
  }, [])

  const handleLogout = () => {
    clearStoredUser()
    api.logout()
    setUser(null)
    setApiKeys([])
  }

  const loadKeys = useCallback(async () => {
    try {
      const keys = await api.listApiKeys()
      setApiKeys(keys)
    } catch {}
  }, [])

  // ─── 添加 Key ───
  const handleAddKey = async () => {
    setKeyLoading(true)
    setKeyError(null)
    try {
      await api.storeApiKey(newKeyEx, newKey, newSecret, false, newKeyLabel)
      setShowAddKey(false)
      setNewKeyLabel('')
      setNewKey('')
      setNewSecret('')
      await loadKeys()
    } catch (err) {
      setKeyError((err as Error).message)
    } finally {
      setKeyLoading(false)
    }
  }

  // ─── 删除 Key ───
  const handleDeleteKey = async (id: number) => {
    try {
      await api.deleteApiKey(id)
      await loadKeys()
    } catch {}
  }

  // ─── 暂停/恢复 ───
  const handleTogglePause = async (key: StoredApiKey) => {
    try {
      const newStatus = key.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
      await api.updateKeyStatus(key.id, newStatus)
      await loadKeys()
    } catch {}
  }

  // ─── 编辑标签 ───
  const handleStartEdit = (key: StoredApiKey) => {
    setEditingId(key.id)
    setEditLabel(key.label)
  }

  const handleSaveLabel = async (id: number) => {
    try {
      await api.updateApiKey(id, {label: editLabel})
      setEditingId(null)
      await loadKeys()
    } catch {}
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <AuthForm onAuth={handleAuth} />

  // ══════════════════════════════════════════
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* 顶栏 */}
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-primary" />
            <h1 className="text-base font-semibold">API 密钥</h1>
            <span className="text-xs text-muted-foreground">
              @{user.username}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {apiKeys.length} 个账户
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddKey(!showAddKey)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary
                         hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              添加 Key
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-red-400
                         hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              退出
            </button>
          </div>
        </div>

        {/* 添加 Key 表单 */}
        {showAddKey && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">备注名称</p>
                <input
                  value={newKeyLabel}
                  onChange={e => setNewKeyLabel(e.target.value)}
                  placeholder="如: 主账户"
                  className="w-28 bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">交易所</p>
                <select
                  value={newKeyEx}
                  onChange={e => setNewKeyEx(e.target.value)}
                  className="w-28 bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary text-gray-200"
                >
                  {EXCHANGE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <p className="text-xs text-muted-foreground mb-1">API Key</p>
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="API Key"
                  className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <p className="text-xs text-muted-foreground mb-1">Secret Key</p>
                <input
                  type="password"
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  placeholder="Secret Key"
                  className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary"
                />
              </div>
              <button
                onClick={handleAddKey}
                disabled={keyLoading || !newKey || !newSecret}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-primary text-white
                           hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                {keyLoading ? '校验中…' : '校验并保存'}
              </button>
            </div>
            {keyError && (
              <div className="flex items-center gap-2 mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {keyError}
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              ⚠️ 建议使用<b>仅只读</b>权限的 API
              Key，交易所后台开启禁止交易和提现
            </p>
          </div>
        )}
      </div>

      {/* Key 列表 */}
      {apiKeys.length > 0 ? (
        <div className="space-y-2">
          {apiKeys.map(k => (
            <div
              key={k.id}
              className="bg-[#18181b] rounded-xl border border-gray-800 p-4
                         hover:border-gray-700 transition-colors"
            >
              <div className="flex flex-wrap items-center gap-3">
                {/* 交易所图标 */}
                <ExchangeIcon exchange={k.exchange} size={22} />

                {/* 标签/编辑 */}
                <div className="flex-1 min-w-0">
                  {editingId === k.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        className="w-36 bg-[#0a0a0b] border border-gray-700 rounded px-2 py-1 text-xs
                                   focus:outline-none focus:border-primary"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveLabel(k.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate max-w-[120px]">
                        {k.label || k.exchange.toUpperCase()}
                      </span>
                      <button
                        onClick={() => handleStartEdit(k)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* API Key 遮掩 */}
                <span className="text-xs font-mono text-muted-foreground hidden sm:inline">
                  {k.apiKey}
                </span>

                {/* 状态徽章 */}
                <StatusBadge status={k.status} />

                {/* 上次同步 */}
                <span className="text-[10px] text-muted-foreground hidden md:inline">
                  {k.lastSyncAt ? `同步: ${fmtTime(k.lastSyncAt)}` : '未同步'}
                </span>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1">
                  {/* 暂停/恢复 */}
                  <button
                    onClick={() => handleTogglePause(k)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground
                               hover:bg-muted/50 transition-colors"
                    title={k.status === 'ACTIVE' ? '暂停同步' : '恢复同步'}
                  >
                    {k.status === 'ACTIVE' ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {/* 删除 */}
                  <button
                    onClick={() => handleDeleteKey(k.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400
                               hover:bg-red-500/10 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 空状态 */
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
          <Key className="w-12 h-12 mb-3 opacity-20" />
          <p className="text-sm">暂无 API Key</p>
          <p className="text-xs mt-1">点击右上角"添加 Key"绑定交易所账户</p>
        </div>
      )}
    </div>
  )
}
