'use client'

import {useState, useEffect} from 'react'
import {authHeaders, API_ORIGIN} from '@/lib/api'

export interface UserConfig {
  klineMode: 'ws' | 'polling'
  klineInterval: number
  allMinQuoteVolume: number
  dailyMinQuoteVolume: number
  currency?: string
  assetAutoSync?: number
}

const defaults: UserConfig = {
  klineMode: 'polling',
  klineInterval: 10000,
  allMinQuoteVolume: 0,
  dailyMinQuoteVolume: 20000000,
  currency: 'USD',
  assetAutoSync: 1
}

export function useUserConfig(): UserConfig {
  const [config, setConfig] = useState<UserConfig>(defaults)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${API_ORIGIN}/api/user/config`, {
      headers: authHeaders(),
      signal: ctrl.signal
    })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) setConfig(d.data)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  return config
}
