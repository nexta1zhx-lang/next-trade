'use client'

import {useCallback, useEffect, useState} from 'react'
import {Save, RotateCcw, Settings2, AlertCircle, Check} from 'lucide-react'

const API_BASE =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''

interface IndicatorConfig {
  minQuoteVolume: number
  topCandidates: number
  topFinal: number
  atrPeriod: number
  bbPeriod: number
  bbStdDev: number
  kcPeriod: number
  kcAtrMultiplier: number
  volumeSpikeThreshold: number
  volumeShrinkThreshold: number
  priceProximityPct: number
  cooldownMs: number
}

const FIELDS: {
  key: keyof IndicatorConfig
  label: string
  desc: string
  step?: number
  min?: number
  max?: number
}[] = [
  {
    key: 'minQuoteVolume',
    label: '最低成交额 (USDT)',
    desc: '过滤低流动性币种',
    step: 1_000_000,
    min: 0
  },
  {
    key: 'topCandidates',
    label: '候选标的数',
    desc: '初筛进入技术指标计算的数量',
    step: 1,
    min: 5,
    max: 100
  },
  {
    key: 'topFinal',
    label: '最终入选数',
    desc: '最终看板展示的数量',
    step: 1,
    min: 3,
    max: 30
  },
  {
    key: 'atrPeriod',
    label: 'ATR 周期',
    desc: '平均真实波幅计算周期',
    step: 1,
    min: 5,
    max: 50
  },
  {
    key: 'bbPeriod',
    label: '布林带周期',
    desc: 'Bollinger Bands 计算周期',
    step: 1,
    min: 5,
    max: 100
  },
  {
    key: 'bbStdDev',
    label: '布林带标准差',
    desc: '标准差倍数',
    step: 0.1,
    min: 0.5,
    max: 5
  },
  {
    key: 'kcPeriod',
    label: '肯特纳通道周期',
    desc: 'Keltner Channel 计算周期',
    step: 1,
    min: 5,
    max: 100
  },
  {
    key: 'kcAtrMultiplier',
    label: '肯特纳 ATR 倍数',
    desc: '通道宽度 = ATR × N',
    step: 0.1,
    min: 0.5,
    max: 5
  },
  {
    key: 'volumeSpikeThreshold',
    label: '放量阈值',
    desc: '突破告警: 当前量 / 均量 >= N',
    step: 0.1,
    min: 1,
    max: 10
  },
  {
    key: 'volumeShrinkThreshold',
    label: '缩量阈值',
    desc: '支撑告警: 当前量 / 均量 <= N',
    step: 0.05,
    min: 0.1,
    max: 1
  },
  {
    key: 'priceProximityPct',
    label: '价格接近阈值',
    desc: '价格在 VWAP/Fib 的 ±N% 内视为接近',
    step: 0.001,
    min: 0.001,
    max: 0.05
  },
  {
    key: 'cooldownMs',
    label: '冷却时间 (ms)',
    desc: '同一标的同时告警最小间隔',
    step: 10_000,
    min: 10_000,
    max: 600_000
  }
]

export default function SettingsPage() {
  const [config, setConfig] = useState<IndicatorConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/market/config`)
      const json = await res.json()
      if (json.success) setConfig(json.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleChange = (key: keyof IndicatorConfig, value: number) => {
    if (!config) return
    setConfig({...config, [key]: value})
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`${API_BASE}/api/market/config`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
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

  const handleReset = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/market/config/reset`, {
        method: 'POST'
      })
      const json = await res.json()
      if (json.success) setConfig(json.data)
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
          <h1 className="text-lg font-semibold">指标参数配置</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground
                       hover:text-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重置
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
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
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-4 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Form */}
      <div className="space-y-3">
        {FIELDS.map(field => {
          const val = config?.[field.key] ?? 0
          return (
            <div
              key={field.key}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    {field.label}
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {field.desc}
                  </p>
                </div>
                <input
                  type="number"
                  value={val}
                  step={field.step ?? 1}
                  min={field.min}
                  max={field.max}
                  onChange={e =>
                    handleChange(field.key, Number(e.target.value))
                  }
                  className="w-28 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-right
                             font-mono tabular-nums text-foreground focus:outline-none focus:border-primary
                             [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                             [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              {/* 滑块 */}
              <input
                type="range"
                value={val}
                min={field.min ?? 0}
                max={field.max ?? 100_000_000}
                step={field.step ?? 1}
                onChange={e => handleChange(field.key, Number(e.target.value))}
                className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary mt-1"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
