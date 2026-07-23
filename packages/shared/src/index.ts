// ─── 交易所 ───
export type ExchangeId =
  | 'binance'
  | 'okx'
  | 'bybit'
  | 'bitget'
  | 'gate'
  | 'mexc'

// ─── 交易对 ───
export interface TradingPair {
  exchange: ExchangeId
  symbol: string // e.g. "BTC/USDT"
  base: string
  quote: string
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

// ─── 订单 ───
export interface Order {
  id: string
  exchange: ExchangeId
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'TAKE_PROFIT'
  price: number
  amount: number
  filled: number
  status: 'OPEN' | 'CLOSED' | 'CANCELED' | 'EXPIRED'
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
  openCst8?: number // 北京时间开盘价 (UTC 16:00)
}

// ─── 排行榜 ───
export interface DailyAnalysisResult {
  date: string // "2026-07-19"
  cachedAt: number // 缓存时间戳
  totalSymbols: number // 原始总数
  filteredCount: number // 过滤后数量
  allItems: DailyAnalysisItem[] // 全量币种（含过滤后所有，用于实时行情）
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

// ─── API Key 管理 ───
export type KeyStatus = 'ACTIVE' | 'INVALID' | 'PAUSED'

export interface StoredApiKey {
  id: number
  label: string // 用户自定义名称，如 "主账户"、"子账户1"
  exchange: string // "binance" | "okx" | "bybit"
  apiKey: string // masked: "bin****f456"
  status: KeyStatus // ACTIVE | INVALID | PAUSED
  lastSyncAt: string | null // ISO 时间戳
  isTestnet: boolean
  createdAt: string
}

export interface ApiKeyDetail extends StoredApiKey {
  exchangeDisplay: string // 交易所显示名
  syncError?: string // 上次同步失败原因
}

export interface UpdateApiKeyPayload {
  label?: string
  apiKey?: string
  apiSecret?: string
  passphrase?: string
}

// ─── 币种标签 ───
export interface SymbolTag {
  id: number
  symbol: string
  tag: string
  color: string
  createdAt: string
}

export interface SymbolTagCreate {
  tag: string
  color?: string
}

// ─── 交易日记 ───
export interface SymbolJournal {
  id: number
  symbol: string
  date: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface SymbolJournalSave {
  date: string
  title?: string
  content: string
}

// ─── 复盘记录（含标签快照） ───
export interface SymbolReview {
  id: number
  symbol: string
  date: string
  title: string
  content: string
  tags: Array<{tag: string; color: string}>
  createdAt: string
  updatedAt: string
}

// ─── 辅助线 ───
export interface DrawingLine {
  id: string
  type: 'horizontal' | 'trendline' | 'vertical'
  time1: number
  price1: number
  time2?: number
  price2?: number
}

export interface SymbolReviewSave {
  date: string
  title?: string
  content: string
  tags?: Array<{tag: string; color: string}>
}

// ─── 自选币种 ───
export interface FavoriteSymbol {
  id: number
  symbol: string
  base: string
  date: string // 加入时的每日行情日期 YYYY-MM-DD
  createdAt: string
}

export interface FavoriteSymbolCreate {
  symbol: string
  base: string
  date: string
}
