import type {
  ApiResponse,
  Ticker,
  AuthUser,
  StoredApiKey
} from '@nexttrade/shared'

// 开发时直连 API 端口（绕过 Next.js proxy 超时限制）
// 生产环境改为同域 /api 或对应域名
const API_ORIGIN =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''
const BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : '/api'

// ─── Token 管理 ───
export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('nexttrade_token')
}

function setToken(token: string) {
  localStorage.setItem('nexttrade_token', token)
}

/** 返回 Authorization header，未登录返回空对象 */
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? {Authorization: `Bearer ${token}`} : {}
}

export function clearToken() {
  localStorage.removeItem('nexttrade_token')
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
  }
}
