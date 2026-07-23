'use client'

import {useState} from 'react'
import {LogIn, UserPlus, AlertCircle} from 'lucide-react'
import {api} from '@/lib/api'

interface LoginDialogProps {
  /** 登录成功回调 */
  onAuth: () => void
  /** 内嵌模式（无卡片容器） */
  inline?: boolean
}

export default function LoginDialog({onAuth, inline}: LoginDialogProps) {
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
      if (mode === 'register') await api.register(username, password)
      else await api.login(username, password)
      onAuth()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const content = (
    <>
      {!inline && (
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
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
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
    </>
  )

  if (inline) return content

  return (
    <div className="max-w-sm mx-auto mt-20">
      <div className="bg-[#18181b] rounded-xl border border-gray-800 p-6">
        {content}
      </div>
    </div>
  )
}
