'use client'

import {useEffect, useState} from 'react'
import {X, LogIn} from 'lucide-react'
import {useRouter} from 'next/navigation'
import {UNAUTHORIZED_EVENT, getToken} from '@/lib/api'

interface Toast {
  id: string
  message: string
  type: 'error' | 'warning'
  action?: {label: string; href: string}
}

export default function GlobalToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const router = useRouter()

  useEffect(() => {
    const on401 = () => {
      // 未登录用户不弹 401
      if (!getToken()) return
      const id = crypto.randomUUID()
      setToasts(prev => [
        ...prev,
        {
          id,
          message: '登录已过期，请重新登录',
          type: 'error',
          action: {label: '去登录', href: '/orders'}
        }
      ])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 6000)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, on401)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on401)
  }, [])

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className="bg-[#1c1c1f] border border-red-500/30 text-gray-300 rounded-xl shadow-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={{animation: 'slideIn 0.3s ease-out'}}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                router.push(t.action!.href)
                dismiss(t.id)
              }}
              className="flex items-center gap-1 px-2 py-1 bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 transition-colors text-xs"
            >
              <LogIn className="w-3 h-3" /> {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <style jsx>{`
            @keyframes slideIn {
              from {
                opacity: 0;
                transform: translateX(100%);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }
          `}</style>
        </div>
      ))}
    </div>
  )
}
