'use client'

import {useRef, useEffect, useCallback} from 'react'
import {getToken, WS_BASE} from '@/lib/api'

/**
 * WebSocket 订阅用户数据流
 * 连接后端 /ws/user?token=xxx，接收币安用户数据事件
 * 收到事件时触发 onUpdate 回调，前端可据此刷新页面数据
 */
export function usePositionWs(onUpdate: () => void, enabled = true) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate // 始终指向最新回调

  const connect = useCallback(() => {
    console.log('[ws position] connect called, enabled:', enabled)
    if (!enabled) return

    const token = getToken()
    console.log(
      '[ws position] token:',
      token ? token.slice(0, 20) + '...' : 'null'
    )
    if (!token) return

    const url = `${WS_BASE}/ws/user?token=${encodeURIComponent(token)}`
    console.log('[ws position] connecting to:', url)
    const ws = new WebSocket(url)

    ws.onopen = () => {
      console.log('[ws position] connected')
      retryCountRef.current = 0
    }

    ws.onmessage = () => {
      onUpdateRef.current()
    }

    ws.onclose = ev => {
      console.log(
        '[ws position] closed, code:',
        ev.code,
        'reason:',
        ev.reason,
        'retry:',
        retryCountRef.current
      )
      wsRef.current = null
      if (!enabled || retryCountRef.current >= 3) return
      retryCountRef.current++
      const delay = Math.min(2000 * 2 ** retryCountRef.current, 30000)
      console.log('[ws position] reconnect in', delay, 'ms')
      reconnectRef.current = setTimeout(connect, delay)
    }

    ws.onerror = ev => {
      console.log('[ws position] error')
      ws.close()
    }

    wsRef.current = ws
  }, [enabled])
}
