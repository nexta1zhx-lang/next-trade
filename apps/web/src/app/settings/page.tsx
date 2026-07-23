'use client'

import {useCallback, useEffect, useState} from 'react'
import {
  Save,
  Settings2,
  AlertCircle,
  Check,
  Wifi,
  RefreshCw
} from 'lucide-react'
import {authHeaders} from '@/lib/api'

const API_BASE =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''

interface UserConfig {
  klineMode: 'ws' | 'polling'
  klineInterval: number
  minQuoteVolume: number
}

export default function SettingsPage() {
  const [config, setConfig] = useState<UserConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/user/config`, {
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
      const res = await fetch(`${API_BASE}/api/user/config`, {
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
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">K 线刷新设置</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !config}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-primary text-primary-foreground
                     rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Config Form */}
      <div className="space-y-4">
        {/* 刷新模式 */}
        <div className="bg-card border border-border rounded-xl p-5">
          <label className="text-sm font-medium text-foreground block mb-3">
            刷新模式
          </label>
          <div className="flex gap-3">
            <button
              onClick={() =>
                setConfig(prev =>
                  prev ? {...prev, klineMode: 'polling'} : null
                )
              }
              className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                config?.klineMode === 'polling'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/30'
              }`}
            >
              <RefreshCw className="w-5 h-5" />
              <div className="text-left">
                <div className="text-sm font-medium">轮询</div>
                <div className="text-xs opacity-70 mt-0.5">
                  定时请求 REST API
                </div>
              </div>
            </button>
            <button
              onClick={() =>
                setConfig(prev => (prev ? {...prev, klineMode: 'ws'} : null))
              }
              className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                config?.klineMode === 'ws'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/30'
              }`}
            >
              <Wifi className="w-5 h-5" />
              <div className="text-left">
                <div className="text-sm font-medium">WebSocket</div>
                <div className="text-xs opacity-70 mt-0.5">交易所实时推送</div>
              </div>
            </button>
          </div>
        </div>

        {/* 轮询间隔（仅轮询模式可配） */}
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
                className="w-20 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-right
                           font-mono tabular-nums text-foreground focus:outline-none focus:border-primary
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
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

        {/* 最低成交额过滤 */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="text-sm font-medium text-foreground">
                最低日成交额
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                每日行情列表只显示成交额大于此值的币种
              </p>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={(config?.minQuoteVolume ?? 20000000) / 1000000}
                min={0}
                max={1000}
                step={1}
                onChange={e =>
                  setConfig(prev =>
                    prev
                      ? {...prev, minQuoteVolume: Number(e.target.value) * 1000000}
                      : null
                  )
                }
                className="w-20 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-right
                           font-mono tabular-nums text-foreground focus:outline-none focus:border-primary
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-sm text-muted-foreground">M</span>
            </div>
          </div>
          <input
            type="range"
            value={(config?.minQuoteVolume ?? 20000000) / 1000000}
            min={0}
            max={1000}
            step={1}
            onChange={e =>
              setConfig(prev =>
                prev
                  ? {...prev, minQuoteVolume: Number(e.target.value) * 1000000}
                  : null
              )
            }
            className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0</span>
            <span>1000M</span>
          </div>
        </div>
      </div>
    </div>
  )
}
