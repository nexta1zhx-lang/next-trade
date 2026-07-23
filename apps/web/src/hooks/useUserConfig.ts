'use client'

import {useState, useEffect} from 'react'
import {authHeaders} from '@/lib/api'

const API_BASE =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''

export interface UserConfig {
  klineMode: 'ws' | 'polling'
  klineInterval: number
  minQuoteVolume: number
}

const defaults: UserConfig = {klineMode: 'polling', klineInterval: 10000, minQuoteVolume: 20000000}

export function useUserConfig(): UserConfig {
  const [config, setConfig] = useState<UserConfig>(defaults)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${API_BASE}/api/user/config`, {
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
