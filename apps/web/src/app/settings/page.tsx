'use client'

import {useCallback, useEffect, useState} from 'react'
import {
  Save,
  Settings2,
  AlertCircle,
  Check,
  Wifi,
  RefreshCw,
  Key,
  Plus,
  LogOut,
  Trash2,
  Edit3,
  Play,
  Pause,
  Calendar,
  Clock,
  FlaskConical
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  authHeaders,
  API_ORIGIN,
  getStoredUser,
  clearStoredUser,
  api
} from '@/lib/api'
import LoginDialog from '@/components/LoginDialog'
import type {AuthUser, StoredApiKey} from '@nexttrade/shared'

interface UserConfig {
  klineMode: 'ws' | 'polling'
  klineInterval: number
  allMinQuoteVolume: number
  dailyMinQuoteVolume: number
  currency?: string
  assetAutoSync?: number
}

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

const EXCHANGE_OPTIONS = [
  {value: 'binance', label: 'Binance'},
  {value: 'okx', label: 'OKX'},
  {value: 'bybit', label: 'Bybit'},
  {value: 'bitget', label: 'Bitget'},
  {value: 'gate', label: 'Gate.io'},
  {value: 'mexc', label: 'MEXC'}
] as const

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

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const EXCHANGE_LABELS: Record<string, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
  bitget: 'Bitget',
  gate: 'Gate.io',
  mexc: 'MEXC'
}

// ══════════════════════════════════════════
// 参数配置子组件
// ══════════════════════════════════════════
function ParamConfig() {
  const [config, setConfig] = useState<UserConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_ORIGIN}/api/user/config`, {
        headers: authHeaders()
      })
      const json = await res.json()
      if (json.success) setConfig(json.data)
      else throw new Error(json.error ?? 'Failed to load')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`${API_ORIGIN}/api/user/config`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json', ...authHeaders()},
        body: JSON.stringify(config)
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Save failed')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* 刷新模式 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <label className="text-sm font-medium text-foreground block mb-3">
          刷新模式
        </label>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={() =>
              setConfig(prev => (prev ? {...prev, klineMode: 'polling'} : null))
            }
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all flex-1 ${
              config?.klineMode === 'polling'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-muted-foreground/30'
            }`}
          >
            <RefreshCw className="w-5 h-5 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-medium">轮询</div>
              <div className="text-xs opacity-70 mt-0.5">定时请求 REST API</div>
            </div>
          </button>
          <button
            onClick={() =>
              setConfig(prev => (prev ? {...prev, klineMode: 'ws'} : null))
            }
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all flex-1 ${
              config?.klineMode === 'ws'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-muted-foreground/30'
            }`}
          >
            <Wifi className="w-5 h-5 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-medium">WebSocket</div>
              <div className="text-xs opacity-70 mt-0.5">交易所实时推送</div>
            </div>
          </button>
        </div>
      </div>

      {/* 轮询间隔 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <label className="text-sm font-medium text-foreground">
              轮询间隔
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              K 线数据自动刷新频率
            </p>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={Math.round((config?.klineInterval ?? 30000) / 1000)}
              min={1}
              max={300}
              step={1}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {...prev, klineInterval: Number(e.target.value) * 1000}
                    : null
                )
              }
              className="w-16 sm:w-20 bg-background border border-border rounded-lg px-2 sm:px-3 py-2 sm:py-1.5 text-sm text-right
                         font-mono tabular-nums text-foreground focus:outline-none focus:border-primary
                         [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-sm text-muted-foreground">秒</span>
          </div>
        </div>
        <input
          type="range"
          value={Math.round((config?.klineInterval ?? 30000) / 1000)}
          min={1}
          max={300}
          step={1}
          onChange={e =>
            setConfig(prev =>
              prev
                ? {...prev, klineInterval: Number(e.target.value) * 1000}
                : null
            )
          }
          className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>1s</span>
          <span>5min</span>
        </div>
      </div>

      {/* 币种筛选设置 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          币种筛选设置
        </h3>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="text-sm font-medium text-foreground">
                  全部 Tab 最低成交额
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  全部标签页中显示的币种最低 USDT 成交额
                </p>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={(config?.allMinQuoteVolume ?? 0) / 1000000}
                  min={0}
                  max={200}
                  step={1}
                  onChange={e =>
                    setConfig(prev =>
                      prev
                        ? {
                            ...prev,
                            allMinQuoteVolume: Number(e.target.value) * 1000000
                          }
                        : null
                    )
                  }
                  className="w-16 sm:w-20 bg-background border border-border rounded-lg px-2 sm:px-3 py-2 sm:py-1.5 text-sm text-right
                             font-mono tabular-nums text-foreground focus:outline-none focus:border-primary
                             [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm text-muted-foreground">M</span>
              </div>
            </div>
            <input
              type="range"
              value={(config?.allMinQuoteVolume ?? 0) / 1000000}
              min={0}
              max={200}
              step={1}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        allMinQuoteVolume: Number(e.target.value) * 1000000
                      }
                    : null
                )
              }
              className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0</span>
              <span>200M</span>
            </div>
          </div>
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="text-sm font-medium text-foreground">
                  每日 Tab 最低成交额
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  每日行情标签页中显示的币种最低 USDT 成交额
                </p>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={(config?.dailyMinQuoteVolume ?? 20000000) / 1000000}
                  min={0}
                  max={200}
                  step={1}
                  onChange={e =>
                    setConfig(prev =>
                      prev
                        ? {
                            ...prev,
                            dailyMinQuoteVolume:
                              Number(e.target.value) * 1000000
                          }
                        : null
                    )
                  }
                  className="w-16 sm:w-20 bg-background border border-border rounded-lg px-2 sm:px-3 py-2 sm:py-1.5 text-sm text-right
                             font-mono tabular-nums text-foreground focus:outline-none focus:border-primary
                             [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm text-muted-foreground">M</span>
              </div>
            </div>
            <input
              type="range"
              value={(config?.dailyMinQuoteVolume ?? 20000000) / 1000000}
              min={0}
              max={200}
              step={1}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        dailyMinQuoteVolume: Number(e.target.value) * 1000000
                      }
                    : null
                )
              }
              className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0</span>
              <span>200M</span>
            </div>
          </div>
        </div>
      </div>

      {/* 显示注册前历史 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-foreground">
              显示注册前历史
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              是否在资产曲线上显示注册前的历史快照数据
            </p>
          </div>
          <button
            onClick={() =>
              setConfig(prev =>
                prev
                  ? {...prev, assetAutoSync: prev.assetAutoSync ? 0 : 1}
                  : null
              )
            }
            className={`relative w-11 h-6 rounded-full transition-colors ${config?.assetAutoSync ? 'bg-primary' : 'bg-gray-600'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${config?.assetAutoSync ? 'translate-x-5' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* 法币设置 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <label className="text-sm font-medium text-foreground block mb-3">
          资产展示法币
        </label>
        <div className="flex gap-2 flex-wrap">
          {['USD', 'CNY', 'EUR', 'JPY', 'GBP'].map(c => (
            <button
              key={c}
              onClick={() =>
                setConfig(prev => (prev ? {...prev, currency: c} : null))
              }
              className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                config?.currency === c
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/30'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !config}
          className="flex items-center gap-1.5 px-4 py-2 text-xs bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {saving ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              保存中
            </>
          ) : success ? (
            <>
              <Check className="w-3.5 h-3.5" />
              已保存
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              保存
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════
// API 密钥管理子组件
// ══════════════════════════════════════════
function ApiKeyManager() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [apiKeys, setApiKeys] = useState<StoredApiKey[]>([])
  const [showAddKey, setShowAddKey] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyEx, setNewKeyEx] = useState('binance')
  const [newKey, setNewKey] = useState('')
  const [newSecret, setNewSecret] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')

  useEffect(() => {
    const stored = getStoredUser()
    setUser(stored)
    if (stored) loadKeys()
    setLoading(false)
  }, [])

  const loadKeys = useCallback(async () => {
    try {
      const keys = await api.listApiKeys()
      setApiKeys(keys)
    } catch {}
  }, [])

  const handleAddKey = async () => {
    setKeyLoading(true)
    setKeyError(null)
    try {
      await api.storeApiKey(newKeyEx, newKey, newSecret)
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

  const handleDeleteKey = async (id: number) => {
    try {
      await api.deleteApiKey(id)
      await loadKeys()
    } catch {}
  }

  const handleTogglePause = async (key: StoredApiKey) => {
    try {
      const newStatus = key.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
      await api.updateKeyStatus(key.id, newStatus)
      await loadKeys()
    } catch {}
  }

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

  const handleLogout = () => {
    clearStoredUser()
    api.logout()
    setUser(null)
    setApiKeys([])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user)
    return (
      <LoginDialog
        onAuth={() => {
          const s = getStoredUser()
          setUser(s)
          if (s) loadKeys()
        }}
      />
    )

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Key className="w-5 h-5 text-primary shrink-0" />
            <h2 className="text-sm font-semibold truncate">API 密钥</h2>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {apiKeys.length} 个
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              @{user.username}
            </span>
            <button
              onClick={() => setShowAddKey(!showAddKey)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加 Key</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">退出</span>
            </button>
          </div>
        </div>

        {showAddKey && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-2 sm:gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">备注名称</p>
                <input
                  value={newKeyLabel}
                  onChange={e => setNewKeyLabel(e.target.value)}
                  placeholder="如: 主账户"
                  className="w-full sm:w-28 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">交易所</p>
                <select
                  value={newKeyEx}
                  onChange={e => setNewKeyEx(e.target.value)}
                  className="w-full sm:w-28 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
                >
                  {EXCHANGE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-0 sm:min-w-40">
                <p className="text-xs text-muted-foreground mb-1">API Key</p>
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="API Key"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex-1 min-w-0 sm:min-w-40">
                <p className="text-xs text-muted-foreground mb-1">Secret Key</p>
                <input
                  type="password"
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  placeholder="Secret Key"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <button
                onClick={handleAddKey}
                disabled={keyLoading || !newKey || !newSecret}
                className="flex items-center justify-center gap-1.5 text-xs px-4 py-2.5 sm:py-2 rounded-lg bg-primary text-white
                           hover:bg-primary/90 disabled:opacity-50 transition-colors w-full sm:w-auto"
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

      {apiKeys.length > 0 ? (
        <div className="space-y-2">
          {apiKeys.map(k => (
            <div
              key={k.id}
              className="bg-card border border-border rounded-xl p-3 sm:p-4 hover:border-muted-foreground/30 transition-colors"
            >
              {/* 第一行：图标 + 名称 + 状态 + 操作 */}
              <div className="flex items-center gap-2 sm:gap-3">
                <ExchangeIcon exchange={k.exchange} size={20} />
                <div className="flex-1 min-w-0">
                  {editingId === k.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        className="w-28 sm:w-36 bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
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
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="text-sm font-medium truncate max-w-24 sm:max-w-40">
                        {k.label ||
                          EXCHANGE_LABELS[k.exchange] ||
                          k.exchange.toUpperCase()}
                      </span>
                      <button
                        onClick={() => handleStartEdit(k)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Testnet 徽标 */}
                {k.isTestnet && (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 shrink-0">
                    <FlaskConical className="w-2.5 h-2.5" />
                    测试网
                  </span>
                )}

                <StatusBadge status={k.status} />
                <div className="flex items-center gap-0.5 sm:gap-1">
                  <button
                    onClick={() => handleTogglePause(k)}
                    className="p-2 sm:p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    title={k.status === 'ACTIVE' ? '暂停同步' : '恢复同步'}
                  >
                    {k.status === 'ACTIVE' ? (
                      <Pause className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    ) : (
                      <Play className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDeleteKey(k.id)}
                    className="p-2 sm:p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                  </button>
                </div>
              </div>

              {/* 第二行：编号 + API Key + 同步时间 + 创建时间 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-[11px] text-muted-foreground">
                <span
                  className="text-muted-foreground/50 font-mono"
                  title="编号"
                >
                  #{k.id}
                </span>
                <span className="hidden sm:inline text-muted-foreground/30">
                  |
                </span>
                <span className="font-mono tracking-wider" title="API Key">
                  {k.apiKey}
                </span>
                <span className="hidden sm:inline text-muted-foreground/30">
                  |
                </span>
                <span className="flex items-center gap-1" title="最后同步">
                  <Clock className="w-3 h-3" />
                  {k.lastSyncAt ? fmtTime(k.lastSyncAt) : '未同步'}
                </span>
                <span className="hidden sm:inline text-muted-foreground/30">
                  |
                </span>
                <span className="flex items-center gap-1" title="创建时间">
                  <Calendar className="w-3 h-3" />
                  {fmtDate(k.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <Key className="w-10 h-10 mb-3 opacity-20" />
          <p className="text-sm">暂无 API Key</p>
          <p className="text-xs mt-1">点击上方"添加 Key"绑定交易所账户</p>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════
// 主页面 - 合并设置
// ══════════════════════════════════════════
export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 lg:px-6 py-3 sm:py-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings2 className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-base sm:text-lg font-semibold">系统设置</h1>
      </div>

      <Tabs.Root defaultValue="apikey">
        <Tabs.List className="flex gap-1 mb-6 border-b border-border">
          <Tabs.Trigger
            value="apikey"
            className="px-4 py-2 text-sm data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary text-muted-foreground transition-colors"
          >
            API 密钥
          </Tabs.Trigger>
          <Tabs.Trigger
            value="config"
            className="px-4 py-2 text-sm data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary text-muted-foreground transition-colors"
          >
            参数配置
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="apikey">
          <ApiKeyManager />
        </Tabs.Content>

        <Tabs.Content value="config">
          <ParamConfig />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
