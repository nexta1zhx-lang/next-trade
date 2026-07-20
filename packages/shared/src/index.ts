// ─── 交易所 ───
export type ExchangeId = 'binance' | 'okx' | 'bybit'

// ─── 交易对 ───
export interface TradingPair {
  exchange: ExchangeId
  symbol: string // e.g. "BTC/USDT"
  base: string
  quote: string
}

// ─── 订单类型 ───
export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit'
export type OrderStatus = 'pending' | 'open' | 'filled' | 'canceled' | 'failed'

export interface Order {
  id: string
  exchange: ExchangeId
  symbol: string
  side: OrderSide
  type: OrderType
  price?: number
  amount: number
  filled: number
  status: OrderStatus
  createdAt: string
  updatedAt: string
}

// ─── 行情 Tick ───
export interface Ticker {
  exchange: ExchangeId
  symbol: string
  price: number
  change24h: number
  volume24h: number
  high24h: number
  low24h: number
  timestamp: number
}

// ─── WebSocket 消息 ───
export type WsMessage =
  | {type: 'ticker'; data: Ticker}
  | {type: 'order_update'; data: Order}
  | {type: 'error'; message: string}

// ─── K 线 OHLCV ───
export interface OHLCV {
  timestamp: number // unix ms
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ─── 单币种日分析 ───
export interface DailyAnalysisItem {
  symbol: string // "BTC/USDT:USDT"
  base: string // "BTC"
  open: number
  high: number
  low: number
  close: number
  amplitude: number // % ((high - low) / open) * 100
  change: number // % ((close - open) / open) * 100
  quoteVolume: number // USDT 成交额
  isDoji: boolean // 十字星标记
}

// ─── 排行榜 ───
export interface DailyAnalysisResult {
  date: string // "2026-07-19"
  cachedAt: number // 缓存时间戳
  totalSymbols: number // 原始总数
  filteredCount: number // 过滤后数量
  rankAmplitude: DailyAnalysisItem[] // 振幅榜 TOP 50
  rankGain: DailyAnalysisItem[] // 涨幅榜 TOP 50
  rankLoss: DailyAnalysisItem[] // 跌幅榜 TOP 50
  rankDoji: DailyAnalysisItem[] // 十字星榜
}

// ─── 分析查询参数 ───
export interface DailyAnalysisQuery {
  date: string // YYYY-MM-DD
  minQuoteVolume?: number // 最小 USDT 成交额过滤
}

// ─── API 通用响应 ───
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
