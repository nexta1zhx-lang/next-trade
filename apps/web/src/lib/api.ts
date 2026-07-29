import type {
  ApiResponse,
  Ticker,
  AuthUser,
  StoredApiKey
} from '@nexttrade/shared'

/**
 * API 地址策略（优先级从高到低）：
 * 1. 同域相对路径（HTTPS 页面自动降级到此，防止 Mixed Content）
 * 2. NEXT_PUBLIC_API_URL 编译时注入（Docker / Capacitor 构建用）
 * 3. 开发时 localhost 自动探测
 *
 * 注意：HTTPS 页面中使用 HTTP 内部地址会被浏览器拦截为 Mixed Content。
 * 此时降级到同域相对路径 /api，由 Caddy/Next.js 代理到后端。
 */
function detectApiOrigin(): string {
  if (typeof window === 'undefined') return ''
  // HTTPS 页面强制降级到同域相对路径
  if (window.location.protocol === 'https:') return ''
  // 编译时注入的环境变量
  const injected = process.env.NEXT_PUBLIC_API_URL
  if (injected) return injected
  // 开发环境自动探测
  if (window.location.hostname === 'localhost') return 'http://localhost:3001'
  return ''
}

export const API_ORIGIN: string = detectApiOrigin()

function detectWsBase(): string {
  const api = detectApiOrigin()
  if (!api) return ''
  return api.replace(/^http/, 'ws')
}

/** WebSocket 连接地址（与 API 同源，仅协议不同） */
export const WS_BASE: string = detectWsBase()

const BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : '/api'

// ─── 全局 401 事件 ───
export const UNAUTHORIZED_EVENT = 'auth:unauthorized'

/** 检查响应状态，401 时触发全局事件 */
export function checkResponse(res: Response): Response {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  }
  return res
}

// ─── Token 管理 ───
export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('nexttrade_token')
}

function setToken(token: string) {
  localStorage.setItem('nexttrade_token', token)
  window.dispatchEvent(new CustomEvent('auth:login'))
}

/** 返回 Authorization header，未登录返回空对象 */
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? {Authorization: `Bearer ${token}`} : {}
}

export function clearToken() {
  localStorage.removeItem('nexttrade_token')
  window.dispatchEvent(new CustomEvent('auth:logout'))
}

export function getStoredUser(): AuthUser | null {
  const raw =
    typeof window !== 'undefined'
      ? localStorage.getItem('nexttrade_user')
      : null
  return raw ? JSON.parse(raw) : null
}

function setStoredUser(user: AuthUser) {
  localStorage.setItem('nexttrade_user', JSON.stringify(user))
}

export function clearStoredUser() {
  localStorage.removeItem('nexttrade_user')
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>)
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...init
  })
  checkResponse(res)
  const json: ApiResponse<T> = await res.json()
  if (!json.success) throw new Error(json.error ?? 'API error')
  return json.data as T
}

export const api = {
  // ─── Ticker ───
  getTicker(exchange: string, symbol: string) {
    return fetchApi<Ticker>(`/ticker?exchange=${exchange}&symbol=${symbol}`)
  },

  // ─── 认证 ───
  async register(username: string, password: string): Promise<AuthUser> {
    const data = await fetchApi<AuthUser>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({username, password})
    })
    setToken(data.token)
    setStoredUser(data)
    return data
  },

  async login(username: string, password: string): Promise<AuthUser> {
    const data = await fetchApi<AuthUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({username, password})
    })
    setToken(data.token)
    setStoredUser(data)
    return data
  },

  logout() {
    clearToken()
    clearStoredUser()
  },

  // ─── V1 API Key 管理 ───
  storeApiKey(
    exchange: string,
    apiKey: string,
    apiSecret: string,
    isTestnet = false,
    label = ''
  ) {
    return fetchApi<StoredApiKey>('/v1/keys', {
      method: 'POST',
      body: JSON.stringify({
        exchangeId: exchange,
        apiKey,
        apiSecret,
        isTestnet,
        label
      })
    })
  },

  listApiKeys() {
    return fetchApi<StoredApiKey[]>('/v1/keys')
  },

  getApiKey(id: number) {
    return fetchApi<StoredApiKey & {exchangeDisplay: string}>(`/v1/keys/${id}`)
  },

  updateApiKey(
    id: number,
    data: {label?: string; apiKey?: string; apiSecret?: string}
  ) {
    return fetchApi<StoredApiKey>(`/v1/keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  },

  updateKeyStatus(id: number, status: 'ACTIVE' | 'PAUSED') {
    return fetchApi<{id: number; status: string}>(`/v1/keys/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({status})
    })
  },

  deleteApiKey(id: number) {
    return fetchApi<{id: number}>(`/v1/keys/${id}`, {method: 'DELETE'})
  },

  // ─── V1 成交查询 ───
  getTrades(params: {
    keyId?: number
    symbol?: string
    startDate?: string
    endDate?: string
    page?: number
    pageSize?: number
  }) {
    const qs = new URLSearchParams()
    if (params.keyId) qs.set('keyId', String(params.keyId))
    if (params.symbol) qs.set('symbol', params.symbol)
    if (params.startDate) qs.set('startDate', params.startDate)
    if (params.endDate) qs.set('endDate', params.endDate)
    if (params.page) qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    return fetchApi<any>(`/v1/trades?${qs}`)
  },

  getTradeStats(params: {
    keyId?: number
    symbol?: string
    startDate?: string
    endDate?: string
  }) {
    const qs = new URLSearchParams()
    if (params.keyId) qs.set('keyId', String(params.keyId))
    if (params.symbol) qs.set('symbol', params.symbol)
    if (params.startDate) qs.set('startDate', params.startDate)
    if (params.endDate) qs.set('endDate', params.endDate)
    return fetchApi<any>(`/v1/trades/stats?${qs}`)
  },

  getOpenPositions(keyId?: number) {
    return fetchApi<any>(`/v1/positions${keyId ? `?keyId=${keyId}` : ''}`)
  },
  getPositionHistory(params: Record<string, any>) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') qs.set(k, String(v))
    }
    return fetchApi<any>(`/v1/positions/history?${qs}`)
  },
  getPositionSummary(params: Record<string, any> = {}) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') qs.set(k, String(v))
    }
    return fetchApi<any>(`/v1/positions/summary?${qs}`)
  },
  getPositionDetail(id: number) {
    return fetchApi<any>(`/v1/positions/${id}`)
  },
  syncTrades(keyId: number, startDate?: string, endDate?: string) {
    return fetchApi<any>('/v1/trades/sync', {
      method: 'POST',
      body: JSON.stringify({keyId, startDate, endDate})
    })
  },
  reconcileTrades(keyId?: number) {
    return fetchApi<any>('/v1/trades/reconcile', {
      method: 'POST',
      body: JSON.stringify({keyId})
    })
  },

  // ─── V2 增量权益 ───
  getEquitySummary(keyId?: number) {
    return fetchApi<any>(`/v2/equity/summary${keyId ? `?keyId=${keyId}` : ''}`)
  },
  getEquityCurve(params: {keyId?: number; days?: number} = {}) {
    const qs = new URLSearchParams()
    if (params.keyId) qs.set('keyId', String(params.keyId))
    if (params.days) qs.set('days', String(params.days))
    return fetchApi<any>(`/v2/equity/curve?${qs}`)
  },
  getEquityToday(keyId?: number) {
    return fetchApi<any>(`/v2/equity/today${keyId ? `?keyId=${keyId}` : ''}`)
  },
  collectEquity() {
    return fetchApi<any>('/v2/equity/collect', {method: 'POST'})
  },

  // ─── 发布订阅 ───
  getPublishSettings() {
    return fetchApi<any>('/v1/publish/settings')
  },
  updatePublishSettings(data: Record<string, any>) {
    return fetchApi<any>('/v1/publish/settings', {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  },
  searchPublicUsers(params: {q?: string; page?: number; pageSize?: number}) {
    const qs = new URLSearchParams()
    if (params.q) qs.set('q', params.q)
    if (params.page) qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    return fetchApi<any>(`/v1/publish/users?${qs}`)
  },
  getMyFollowing() {
    return fetchApi<any>('/v1/publish/following')
  },
  followUser(userId: number) {
    return fetchApi<any>('/v1/publish/follow', {
      method: 'POST',
      body: JSON.stringify({userId})
    })
  },
  unfollowUser(userId: number) {
    return fetchApi<any>(`/v1/publish/follow/${userId}`, {
      method: 'DELETE'
    })
  },
  getPublicUserData(userId: number) {
    return fetchApi<any>(`/v1/publish/user/${userId}`)
  },
  getPublishStats() {
    return fetchApi<any>('/v1/publish/stats')
  }
}
