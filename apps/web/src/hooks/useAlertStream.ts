'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import type {PriceAlert} from '@nexttrade/shared'

const SSE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001/api/stream/alerts'
    : '/api/stream/alerts'

export interface AlertEvent {
  type: 'connected' | 'alert'
  alert?: PriceAlert
}

type AlertListener = (event: AlertEvent) => void

/**
 * 全局 SSE 连接管理器（单例）
 * 所有组件共享同一个 EventSource 连接
 */
class AlertStreamManager {
  private es: EventSource | null = null
  private listeners = new Set<AlertListener>()
  private retryCount = 0
  private maxRetries = 5

  connect(): void {
    if (this.es?.readyState === EventSource.OPEN) return

    this.es = new EventSource(SSE_URL)

    this.es.addEventListener('connected', () => {
      this.retryCount = 0
      this.broadcast({type: 'connected'})
    })

    this.es.addEventListener('alert', (e: MessageEvent) => {
      try {
        const alert = JSON.parse(e.data) as PriceAlert
        this.broadcast({type: 'alert', alert})
      } catch {
        // ignore
      }
    })

    this.es.onerror = () => {
      this.cleanup()
      if (this.retryCount < this.maxRetries) {
        this.retryCount++
        setTimeout(() => this.connect(), 3000 * this.retryCount)
      }
    }
  }

  subscribe(listener: AlertListener): () => void {
    this.listeners.add(listener)
    if (!this.es || this.es.readyState !== EventSource.OPEN) {
      this.connect()
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.disconnect()
    }
  }

  private broadcast(event: AlertEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private cleanup(): void {
    if (this.es) {
      this.es.close()
      this.es = null
    }
  }

  private disconnect(): void {
    this.cleanup()
    this.retryCount = 0
  }
}

const manager = new AlertStreamManager()

/**
 * 订阅实时告警流
 */
export function useAlertStream(): {
  lastAlert: PriceAlert | null
  isConnected: boolean
} {
  const [lastAlert, setLastAlert] = useState<PriceAlert | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const unsub = manager.subscribe(event => {
      if (event.type === 'connected') {
        setIsConnected(true)
      } else if (event.alert) {
        setLastAlert(event.alert)
      }
    })
    return unsub
  }, [])

  return {lastAlert, isConnected}
}

/**
 * 获取最近 N 条告警（用于跑马灯）
 */
export function useAlertHistory(max = 50): PriceAlert[] {
  const [alerts, setAlerts] = useState<PriceAlert[]>([])

  useEffect(() => {
    const unsub = manager.subscribe(event => {
      if (event.type === 'alert' && event.alert) {
        setAlerts(prev => [event.alert!, ...prev].slice(0, max))
      }
    })
    return unsub
  }, [max])

  return alerts
}

export function useLatestAlerts(): PriceAlert[] {
  return useAlertHistory(50)
}
