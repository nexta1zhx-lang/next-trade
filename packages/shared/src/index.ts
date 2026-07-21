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

// ─── 合约震荡榜条目 ───
export interface VolatilityItem {
  symbol: string
  base: string
  open: number
  high: number
  low: number
  close: number
  amplitude: number // 全振幅 % (high - low) / low * 100
  bodyRange: number // 实体振幅 % |close - open| / low * 100
  upperWick: number // 上影线 % (high - max(open,close)) / low * 100
  lowerWick: number // 下影线 % (min(open,close) - low) / low * 100
  change: number // 涨跌幅 % (close - open) / open * 100
  quoteVolume: number // USDT 成交额
  rank: number // 排名
}

// ─── 合约震荡榜结果 ───
export interface VolatilityRankResult {
  exchange: string
  date: string
  updatedAt: number
  top: VolatilityItem[]
}

// ─── 动态点位 ───
export interface WatchlistItem {
  symbol: string
  base: string
  lastPrice: number
  dayHigh: number
  dayLow: number
  vwap: number
  fib0382: number
  fib0618: number
  isSqueeze: boolean
  atr: number
  amplitude: number
  quoteVolume: number
  score: number
  updatedAt: number
}

export interface WatchlistResult {
  date: string
  items: WatchlistItem[]
}

// ─── 告警事件 ───
export type AlertType = 'breakout' | 'support' | 'squeeze_release'

export interface PriceAlert {
  id: string
  type: AlertType
  symbol: string
  base: string
  price: number
  message: string
  severity: 'info' | 'warning' | 'danger'
  timestamp: number
}

// ─── API 通用响应 ───
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ─── 用户认证 ───
export interface AuthUser {
  id: number
  username: string
  token: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  password: string
}

// ─── 交易审计记录 ───
export interface TradeAuditRecord {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  entryPrice: number
  exitPrice: number
  realizedPnl: number
  fee: number
  mae: number // Maximum Adverse Excursion (%)
  mfe: number // Maximum Favorable Excursion (%)
  openedAt: string // ISO
  closedAt: string // ISO
  orderId: string
  volume: number
}

export interface TradeAuditResult {
  keyId: number
  exchange: string
  startDate: string
  endDate: string
  records: TradeAuditRecord[]
  totalPnl: number
  totalFee: number
  winRate: number
  tradeCount: number
  tradeVolume: number
}

// ─── 交易复盘 ───
export interface TradeReview {
  id: number
  userId: number
  tradeAuditId: string
  symbol: string
  strategyTags: string[]
  errorTags: string[]
  rating: number // 1-5
  notes: string // Markdown
  createdAt: string
  updatedAt: string
}

export interface TradeReviewSave {
  tradeAuditId: string
  symbol: string
  strategyTags: string[]
  errorTags: string[]
  rating: number
  notes: string
}

// ─── API Key 管理 ───
export interface StoredApiKey {
  id: number
  label: string // 用户自定义名称，如 "主账户"、"子账户1"
  exchange: string // "binance" | "okx" | "bybit"
  apiKey: string // masked: "bin****f456"
  isTestnet: boolean
  createdAt: string
}

// ─── K 线买卖点数据 ───
export interface TradeCandle {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TradeMarker {
  time: number // unix seconds
  position: 'aboveBar' | 'belowBar'
  color: string
  shape: 'arrowUp' | 'arrowDown'
  text: string
}
