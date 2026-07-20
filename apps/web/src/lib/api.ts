import type {ApiResponse, Ticker, Order} from '@nexttrade/shared'

// 开发时直连 API 端口（绕过 Next.js proxy 超时限制）
// 生产环境改为同域 /api 或对应域名
const API_ORIGIN =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : ''
const BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : '/api'

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {'Content-Type': 'application/json', ...init?.headers},
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
  }
}
