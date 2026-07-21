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

// ─── 资金曲线 ───
export interface EquityPoint {
  /** UTC 日期 YYYY-MM-DD */
  date: string
  /** 当日净值（USDT） */
  netValue: number
  /** 累计收益率（%） */
  cumulativeReturn: number
  /** 当日盈亏（USDT） */
  dailyPnl: number
  /** 距前期高点回撤（%） */
  drawdown: number
  /** 累计已实现盈亏（USDT） */
  cumulativePnl: number
}

export interface EquityPerformanceMetrics {
  /** 夏普比率（年化，无风险利率 4%） */
  sharpeRatio: number
  /** 卡尔玛比率（年化收益率 / 最大回撤） */
  calmarRatio: number
  /** 年化收益率（%） */
  annualizedReturn: number
  /** 年化波动率（%） */
  annualizedVolatility: number
  /** 胜率（%）- 盈利天数占比 */
  winRate: number
  /** 盈亏比 */
  profitLossRatio: number
  /** 盈利天数 */
  winDays: number
  /** 亏损天数 */
  lossDays: number
  /** 日均盈亏 */
  avgDailyPnl: number
  /** 最大单日盈利 */
  maxDailyWin: number
  /** 最大单日亏损 */
  maxDailyLoss: number
  /** 净值高点到当前的回撤持续天数 */
  drawdownDays: number
  /** 回撤恢复天数（从峰值到恢复的天数） */
  recoveryDays: number
}

export interface EquityCurveData {
  /** 起始日期 */
  startDate: string
  /** 结束日期 */
  endDate: string
  /** 初始资金（USDT） */
  initialCapital: number
  /** 最新净值 */
  currentNetValue: number
  /** 累计收益率（%） */
  totalReturn: number
  /** 历史最大回撤（%） */
  maxDrawdown: number
  /** 曲线数据点 */
  points: EquityPoint[]
  /** 增强性能指标 */
  metrics?: EquityPerformanceMetrics
  /** 基准对比数据（可选） */
  benchmark?: {
    name: string
    points: Array<{date: string; value: number}>
  }
  /** 数据来源: snapshot=快照精确值, trade=成交推算 */
  source?: 'snapshot' | 'trade'
  /** 缓存时间戳 */
  cachedAt?: number
}
