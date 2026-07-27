'use client'

import {useEffect} from 'react'
import {API_ORIGIN} from '@/lib/api'

/**
 * 全局错误捕获器 — 将前端 JS 错误发送到后端日志
 * 用于 USB 无法连接时的远程调试
 */
export function DebugLogger() {
  useEffect(() => {
    // 捕获未处理的 promise 错误
    const handleRejection = (e: PromiseRejectionEvent) => {
      console.error('[未捕获 Promise]', e.reason)
      logError('unhandledrejection', e.reason)
    }

    // 捕获运行时错误
    const handleError = (e: ErrorEvent) => {
      console.error('[运行时错误]', e.message, e.filename, e.lineno)
      logError('error', {
        message: e.message,
        filename: e.filename,
        line: e.lineno
      })
    }

    window.addEventListener('unhandledrejection', handleRejection)
    window.addEventListener('error', handleError)

    return () => {
      window.removeEventListener('unhandledrejection', handleRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])

  return null
}

async function logError(type: string, detail: unknown) {
  try {
    await fetch(`${API_ORIGIN}/api/debug/log`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        type,
        detail,
        url: location.href,
        userAgent: navigator.userAgent
      })
    })
  } catch {
    // 静默失败
  }
}
