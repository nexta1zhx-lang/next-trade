'use client'

import {useCallback, useEffect, useState} from 'react'
import {
  Key,
  Plus,
  AlertCircle,
  LogIn,
  UserPlus,
  LogOut,
  Trash2
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

// ─── 子组件: 登录/注册 ───
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
      if (mode === 'register') {
        await api.register(username, password)
      } else {
        await api.login(username, password)
      }
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
          <div>
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
          </div>
          <div>
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
          </div>

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

// ══════════════════════════════════════════════════
// 主页面
// ══════════════════════════════════════════════════

export default function OrdersPage() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // ─── API Key 状态 ───
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([])
  const [showAddKey, setShowAddKey] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyEx, setNewKeyEx] = useState('binance')
  const [newKey, setNewKey] = useState('')
  const [newSecret, setNewSecret] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(false)

  // ─── 初始化：检查登录状态 + 加载 API Key ───
  useEffect(() => {
    const stored = getStoredUser()
    setUser(stored)
    if (stored) {
      loadKeys()
    }
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 登录后自动加载 API Key
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

  // ─── 加载 API Key ───
  const loadKeys = useCallback(async () => {
    try {
      const keys = await api.listApiKeys()
      setApiKeys(keys)
    } catch {
      // ignore
    }
  }, [])

  // ─── 添加 API Key ───
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

  // ─── 删除 API Key ───
  const handleDeleteKey = async (id: number) => {
    try {
      await api.deleteApiKey(id)
      await loadKeys()
    } catch {
      // ignore
    }
  }

  // ─── 加载中 ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─── 未登录 ───
  if (!user) {
    return <AuthForm onAuth={handleAuth} />
  }

  // ══════════════════════════════════════════════
  // 已登录: API Key 管理界面
  // ══════════════════════════════════════════════
  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* ─── 顶栏：用户 + Key 管理 ─── */}
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-primary" />
            <h1 className="text-base font-semibold">API 密钥</h1>
            <span className="text-xs text-muted-foreground">
              @{user.username}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddKey(!showAddKey)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary
                         hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {apiKeys.length === 0 ? '添加 API Key' : '添加 Key'}
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
              {/* 自定义名称 */}
              <div className="w-full sm:w-auto">
                <p className="text-xs text-muted-foreground mb-1">备注名称</p>
                <input
                  value={newKeyLabel}
                  onChange={e => setNewKeyLabel(e.target.value)}
                  placeholder="如: 主账户 / 子账户1"
                  className="w-32 bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary"
                />
              </div>
              {/* 交易所选择 */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">交易所</p>
                <select
                  value={newKeyEx}
                  onChange={e => setNewKeyEx(e.target.value)}
                  className="w-28 bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary text-gray-200"
                >
                  <option value="binance">Binance</option>
                  <option value="okx" disabled>
                    OKX (即将支持)
                  </option>
                  <option value="bybit" disabled>
                    Bybit (即将支持)
                  </option>
                </select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="text-xs text-muted-foreground mb-1">API Key</p>
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="binance API Key"
                  className="w-full bg-[#0a0a0b] border border-gray-700 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="text-xs text-muted-foreground mb-1">Secret Key</p>
                <input
                  type="password"
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  placeholder="binance Secret Key"
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
              ⚠️ 请确保 API Key 在币安后台设置为
              <strong>仅只读 (Read-Only)</strong>，禁用交易权限
            </p>
          </div>
        )}

        {/* Key 列表 */}
        {apiKeys.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {apiKeys.map(k => (
              <div
                key={k.id}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border
                           border-gray-700 text-muted-foreground"
              >
                <ExchangeIcon exchange={k.exchange} size={18} />
                {k.label && (
                  <span className="text-muted-foreground truncate max-w-[80px]">
                    {k.label}
                  </span>
                )}
                <Key className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[100px]">{k.apiKey}</span>
                <button
                  onClick={() => handleDeleteKey(k.id)}
                  className="text-gray-600 hover:text-red-400 shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 空状态 */}
        {apiKeys.length === 0 && !showAddKey && (
          <div className="mt-4 text-center py-8 text-muted-foreground">
            <Key className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">暂无 API Key</p>
            <p className="text-xs mt-1">
              点击上方"添加 API Key"按钮添加交易所密钥
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
