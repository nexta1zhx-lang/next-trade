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

export type StreamEvent = TradeEvent | PositionUpdateEvent | ReconciliationEvent

/** Stream Key 命名 */
export const STREAM_KEY = 'trade_events'
export const CONSUMER_GROUP = 'position_processor'
export const CONSUMER_NAME = `worker_${process.env.HOSTNAME ?? 'default'}`
// 最大消息保留 (7天)
export const STREAM_MAXLEN = 1_000_000
