/**
 * 多交易所通用仓位数据契约
 *
 * 统一各大交易所（Binance, OKX, Bybit）的持仓数据结构，
 * 解决 OKX 张数 → 币数换算、单双向持仓差异等核心问题。
 */

// ─── 交易所标识 ───
export type ExchangeId = 'binance' | 'okx' | 'bybit'

// ─── 仓位方向 ───
export type PositionSide = 'long' | 'short'

// ─── 保证金模式 ───
export type MarginType = 'cross' | 'isolated'

// ─── API 凭据 ───
export interface ApiCredentials {
  apiKey: string
  apiSecret: string
  /** OKX 需要 */
  passphrase?: string
}

// ─── 归一化仓位 ───
export interface UnifiedPosition {
  /** 全局唯一 ID，格式: `${exchange}:${symbol}:${side}` */
  id: string

  /** 交易所 */
  exchange: ExchangeId

  /** 标准交易对，如 "SOL/USDT" */
  symbol: string

  /** 交易所原生 symbol，如 "SOLUSDT" */
  rawSymbol: string

  /** 方向 */
  side: PositionSide

  /**
   * 真实币数数量（绝对值，非张数）
   * OKX 需要: contracts × contractSize 换算
   * Binance: 直接用 CCXT 的 contracts（本身就是币数）
   */
  baseAmount: number

  /** 仓位总美元价值 = baseAmount × markPrice */
  notionalUsd: number

  /** 开仓均价 */
  entryPrice: number

  /** 标记价格 */
  markPrice: number

  /** 未实现盈亏（美元） */
  unrealizedPnlUsd: number

  /** 未实现盈亏率（百分比） */
  unrealizedPnlPercentage: number

  /** 杠杆倍数 */
  leverage: number

  /** 保证金模式 */
  marginType: MarginType

  /** 更新时间（毫秒时间戳） */
  updatedAt: number
}

// ─── 持仓查询结果 ───
export interface PositionQueryResult {
  exchange: ExchangeId
  success: boolean
  positions: UnifiedPosition[]
  error?: string
}
