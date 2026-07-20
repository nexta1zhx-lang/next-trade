import type { ApiResponse, Ticker, Order } from '@nexttrade/shared';

const BASE_URL = '/api';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) throw new Error(json.error ?? 'API error');
  return json.data as T;
}

export const api = {
  // ─── Ticker ───
  getTicker(exchange: string, symbol: string) {
    return fetchApi<Ticker>(`/ticker?exchange=${exchange}&symbol=${symbol}`);
  },

  // ─── Orders ───
  getOrders() {
    return fetchApi<Order[]>('/orders');
  },

  createOrder(data: {
    exchange: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    amount: number;
    price?: number;
  }) {
    return fetchApi<Order>('/orders', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
