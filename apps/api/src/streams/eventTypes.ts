/**
 * 标准事件类型 — 采集层到计算层的统一格式
 *
 * Ingestion Worker 拉取/接收数据后，标准化为以下事件写入 Redis Streams
 * Processor Worker 消费事件，写入 DB 并触发仓位计算
 */

/** 成交事件 */
export interface TradeEvent {
  type: 'TRADE_FILLED'
  apiKeyId: number
  tradeId: string
  symbol: string
  marketType: 'PERP'
  side: 'OPEN_LONG' | 'CLOSE_LONG' | 'OPEN_SHORT' | 'CLOSE_SHORT'
  price: string
  amount: string
  quoteQty: string
  realizedPnl: string
  feeUsdt: string
  isLiquidation: boolean
  executedAt: number // ms timestamp
}

/** 持仓变动事件（触发仓位重算） */
export interface PositionUpdateEvent {
  type: 'POSITION_UPDATE'
  apiKeyId: number
  /** 受影响的 symbol，为空则重算所有 */
  symbols?: string[]
}

/** 数据对账事件（补洞完成，触发全量校验） */
export interface ReconciliationEvent {
  type: 'RECONCILIATION'
  apiKeyId: number
  since: number // ms timestamp
}

/** 权益变动事件 — WS ACCOUNT_UPDATE 驱动 */
export interface EquityUpdateEvent {
  type: 'EQUITY_UPDATE'
  apiKeyId: number
  /** 交易所时间戳 */
  eventTime: number
  /** U本位合约钱包余额（USDT） */
  futuresWallet: string
  /** U本位合约未实现盈亏 */
  unrealizedPnl: string
  /** 权益变化量（相对上一条 tick） */
  deltaEquity: string
  /** 是否为强平事件 */
  isLiquidation: boolean
}

/** 权益校准事件 — 周期 REST 拉取触发 */
export interface EquityReconcileEvent {
  type: 'EQUITY_RECONCILE'
  apiKeyId: number
  /** REST 拉取的完整权益 */
  futuresWallet: string
  unrealizedPnl: string
  fundingUsdt: string
}

export type StreamEvent =
  | TradeEvent
  | PositionUpdateEvent
  | ReconciliationEvent
  | EquityUpdateEvent
  | EquityReconcileEvent

/** Stream Key 命名 — 交易事件 */
export const STREAM_KEY = 'trade_events'
export const CONSUMER_GROUP = 'position_processor'
export const CONSUMER_NAME = `worker_${process.env.HOSTNAME ?? 'default'}`
// 最大消息保留 (7天)
export const STREAM_MAXLEN = 1_000_000

/** Stream Key 命名 — 权益事件（独立流，避免与交易事件争抢） */
export const EQUITY_STREAM_KEY = 'equity_events'
export const EQUITY_CONSUMER_GROUP = 'equity_processor'
export const EQUITY_CONSUMER_NAME = `equity_${process.env.HOSTNAME ?? 'default'}`
export const EQUITY_STREAM_MAXLEN = 500_000
