import type {
  ApiResponse,
  Ticker,
  Order,
  AuthUser,
  StoredApiKey,
  TradeAuditResult,
  TradeReview,
  TradeReviewSave
} from '@nexttrade/shared'

// 开发时直连 API 端口（绕过 Next.js proxy 超时限制）
// 生产环境改为同域 /api 或对应域名
const API_ORIGIN =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''
const BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : '/api'

// ─── Token 管理 ───
function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('nexttrade_token')
}

function setToken(token: string) {
  localStorage.setItem('nexttrade_token', token)
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

  // ─── Orders ───
  getOrders() {
    return fetchApi<Order[]>('/orders')
  },

  createOrder(data: {
    exchange: string
    symbol: string
    side: 'buy' | 'sell'
    type: 'market' | 'limit'
    amount: number
    price?: number
  }) {
    return fetchApi<Order>('/orders', {
      method: 'POST',
      body: JSON.stringify(data)
    })
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

  // ─── API Key 管理 ───
  storeApiKey(
    exchange: string,
    apiKey: string,
    apiSecret: string,
    isTestnet = false,
    label = ''
  ) {
    return fetchApi<StoredApiKey>('/trade-audit/keys', {
      method: 'POST',
      body: JSON.stringify({exchange, apiKey, apiSecret, isTestnet, label})
    })
  },

  listApiKeys() {
    return fetchApi<StoredApiKey[]>('/trade-audit/keys')
  },

  deleteApiKey(id: number) {
    return fetchApi<{id: number}>(`/trade-audit/keys/${id}`, {method: 'DELETE'})
  },

  // ─── 交易审计 ───
  analyzeTrades(params: {
    keyId: number
    symbol?: string
    startDate: string
    endDate: string
    orderId?: string
  }) {
    return fetchApi<TradeAuditResult & {candles: any[]; markers: any[]}>(
      '/trade-audit/analyze',
      {method: 'POST', body: JSON.stringify(params)}
    )
  },

  // ─── 按需 K 线（展开交易时调用） ───
  getTradeCandles(params: {
    keyId: number
    symbol: string
    entryPrice: number
    side: 'buy' | 'sell'
    openedAt: number
    closedAt: number
  }) {
    return fetchApi<{candles: any[]; markers: any[]; mae: number; mfe: number}>(
      '/trade-audit/candles',
      {method: 'POST', body: JSON.stringify(params)}
    )
  },

  // ─── 仓位历史（bapi position/history） ───
  getPositionHistory(params: {
    keyId: number
    symbol?: string
    startDate?: string
    endDate?: string
  }) {
    const qs = new URLSearchParams({keyId: String(params.keyId)})
    if (params.symbol) qs.set('symbol', params.symbol)
    if (params.startDate) qs.set('startDate', params.startDate)
    if (params.endDate) qs.set('endDate', params.endDate)
    return fetchApi<{records: any[]; count: number}>(
      `/v1/position-history?${qs}`
    )
  },

  // ─── 交易复盘 ───
  saveReview(data: TradeReviewSave) {
    return fetchApi<TradeReview>('/trade-audit/reviews', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  },

  listReviews() {
    return fetchApi<TradeReview[]>('/trade-audit/reviews')
  },

  deleteReview(id: number) {
    return fetchApi<{id: number}>(`/trade-audit/reviews/${id}`, {
      method: 'DELETE'
    })
  }
}
