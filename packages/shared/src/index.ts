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
  date?: string
  title?: string
  content: string
  tags?: Array<{tag: string; color: string}>
}

// ─── 自选币种 ───
export interface FavoriteSymbol {
  id: number
  symbol: string
  base: string
  createdAt: string
  /** 近 10 天进入振幅榜前 10 的次数 */
  top10Count?: number
}

export interface FavoriteSymbolCreate {
  symbol: string
  base: string
}

// ─── 资产快照（精简版） ───
export interface AssetCurrent {
  /** 无数据时后端返回的 Key 标签 */
  label?: string
  totalNetVal: number
  fundingVal: number
  spotVal: number
  futuresUVal: number
  futuresCoinVal: number
  earnVal: number
  /** ISO 时间戳，无数据时为 null */
  snapshotAt: string | null
  wsUpdateAt?: string
  /** 累计净入金（入金-出金，用于剔除出入金干扰的收益计算） */
  netDeposit?: number
}

export interface AssetTodayExtremes {
  highVal: number
  highTime: string | null
  lowVal: number
  lowTime: string | null
}

export interface AssetTodayData {
  extremes: AssetTodayExtremes | null
  intraday: Array<{time: string; value: number}>
}

export interface AssetDailyOHLC {
  date: string
  openVal: number
  highVal: number
  lowVal: number
  closeVal: number
  amplitude: number
  highTime: string | null
  lowTime: string | null
}

export interface AssetSnapshotRow {
  snapshotAt: string
  totalNetVal: string
  fundingVal: string | null
  spotVal: string | null
  futuresUVal: string | null
  futuresCoinVal: string | null
  earnVal: string | null
}

// ─── 区间分析 ───
export interface AssetPeriodAnalysis {
  periodPnL: number
  periodROI: number
  rawChange: number
  annualizedROI: number | null
  periodMDD: number
  mddStartDate: string | null
  mddEndDate: string | null
  days: number
  netDeposit: number
}

// ─── 合约仓位 ───
export type PositionSide = 'LONG' | 'SHORT'

export interface OpenPosition {
  symbol: string
  positionSide: PositionSide
  quantity: number
  entryPrice: number
  markPrice: number
  liquidationPrice: number
  leverage: number
  marginType: 'isolated' | 'cross'
  unrealizedPnl: number
  notional: number
  updateTime: number
}

export interface PositionRecord {
  id: number
  apiKeyId: number
  symbol: string
  positionSide: PositionSide
  status: 'OPEN' | 'CLOSED'
  entryPrice: number
  exitPrice: number | null
  quantity: number
  realizedPnl: number
  totalFee: number
  roiPct: number | null
  maxDrawdownPct: number | null
  holdingSeconds: number | null
  isLiquidation: boolean
  openedAt: string
  closedAt: string | null
}

export interface PositionDetail extends PositionRecord {
  orders: Array<{
    tradeId: string
    price: number
    amount: number
    side: string
    realizedPnl: number
    feeUsdt: number
    isLiquidation: boolean
    executedAt: string
  }>
  /** 分组汇总：开仓合并、平仓合并 */
  orderSummary: {
    entryCount: number
    entryAvgPrice: number
    entryTotalAmount: number
    entryTotalFee: number
    exitCount: number
    exitAvgPrice: number
    exitTotalAmount: number
    exitTotalFee: number
    exitRealizedPnl: number
  }
  analysis: {
    holdingTimeFormatted: string
    netPnl: number
    roiPct: number
    maxDrawdownPct: number
    winLoss: 'win' | 'loss' | 'breakeven'
  }
}

export interface PositionSummary {
  totalOpenPositions: number
  totalClosedPositions: number
  totalRealizedPnl: number
  totalFee: number
  winCount: number
  lossCount: number
  winRate: number
  totalLiquidationCount: number
  avgHoldingSeconds: number
  avgRoiPct: number
}

// ─── 发布订阅 ───

/** 持仓公开粒度 */
export type PositionGranularity = 'basic' | 'full'

/** 发布设置 */
export interface PublishSettings {
  isPublic: boolean
  showPositions: boolean
  positionGranularity: PositionGranularity
  showCapital: boolean
  showOrders: boolean
  updatedAt: string
}

/** 更新发布设置载荷 */
export interface PublishSettingsUpdate {
  isPublic?: boolean
  showPositions?: boolean
  positionGranularity?: PositionGranularity
  showCapital?: boolean
  showOrders?: boolean
}

/** 公开成交记录条目 */
export interface PublicTrade {
  tradeId: string
  symbol: string
  side: string
  price: number
  amount: number
  realizedPnl: number
  executedAt: string
}

/** 公开用户信息（搜索结果） */
export interface PublicUser {
  id: number
  username: string
  isFollowing: boolean
  settings: PublishSettings
  /** 当前公开持仓数量 */
  openPositionCount?: number
  /** 累计盈亏（basic 粒度不暴露具体金额） */
  totalPnl?: number
}

/** 用户的公开仓位（精简版） */
export interface PublicPosition {
  symbol: string
  positionSide: PositionSide
  entryPrice: number
  markPrice: number
  unrealizedPnl: number
  roiPct: number
  leverage: number
  marginType: string
}

/** 用户的公开资金概况 */
export interface PublicCapital {
  totalNetVal: number
  dayPnl: number
  dayPnlPct: number
  snapshotAt: string | null
}

/** 用户公开数据聚合 */
export interface PublicUserData {
  user: Pick<PublicUser, 'id' | 'username'>
  positions?: PublicPosition[]
  capital?: PublicCapital
  trades?: PublicTrade[]
  updatedAt: string
}

/** 关注列表条目 */
export interface FollowItem {
  id: number
  followingId: number
  username: string
  settings: PublishSettings
  openPositionCount: number
  createdAt: string
}

// ─── 版本信息 ───
export const APP_VERSION = '0.1.0'
export const APP_BUILD = 1
export const APP_NAME = 'nextTrade'
export const APP_DESCRIPTION = 'AI 辅助的 Web3 + CEX 量化交易平台'
