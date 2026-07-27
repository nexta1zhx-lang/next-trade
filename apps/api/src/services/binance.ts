/**
 * Binance 永续合约 (USDT-M) 直连 API 服务
 * 替代 CCXT，直接调用 Binance REST API，避免数据差异
 */

const BASE = 'https://fapi.binance.com'

/** K 线数据格式 */
export interface BinanceKline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** 24hr Ticker 格式 */
export interface BinanceTicker {
  symbol: string
  price: string
  change: string
  changePct: string
  high: string
  low: string
  volume: string
  quoteVol: string
}

/**
 * 获取 K 线数据
 * GET /fapi/v1/klines
 */
export async function fetchKlines(
  symbol: string,
  timeframe: string,
  limit = 300,
  since?: number
): Promise<BinanceKline[]> {
  const params = new URLSearchParams({
    symbol,
    interval: timeframe,
    limit: String(limit)
  })
  if (since) params.set('startTime', String(since))

  const res = await fetch(`${BASE}/fapi/v1/klines?${params}`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Binance klines error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as unknown[][]
  return data.map(c => ({
    time: Math.floor((c[0] as number) / 1000),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  }))
}

/**
 * 获取全量 24hr Ticker
 * GET /fapi/v1/ticker/24hr
 */
export async function fetchAllTickers(): Promise<BinanceTicker[]> {
  const res = await fetch(`${BASE}/fapi/v1/ticker/24hr`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Binance ticker error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as any[]
  return data.map(t => ({
    symbol: t.symbol,
    price: t.lastPrice,
    change: t.priceChange,
    changePct: t.priceChangePercent,
    high: t.highPrice,
    low: t.lowPrice,
    volume: t.volume,
    quoteVol: t.quoteVolume
  }))
}
