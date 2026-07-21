/**
 * 交易所适配器接口规范
 *
 * 所有交易所（Binance, OKX, Bybit）都必须实现此接口：
 *   - validateCredentials: 校验 API Key 只读权限
 *   - fetchPositions: 拉取当前持仓（归一化）
 *   - fetchTradeHistory: 拉取历史成交 + 计算 MAE/MFE
 *   - fetchKlines: 拉取 K 线数据
 */

import type {
  ExchangeId,
  ApiCredentials,
  UnifiedPosition
} from '../types/position.js'
import type {TradeCandle, TradeMarker} from '@nexttrade/shared'

// ─── 凭据校验结果 ───
export interface CredentialValidation {
  valid: boolean
  canTrade?: boolean
  error?: string
}

// ─── 历史成交查询参数 ───
export interface TradeHistoryQuery {
  symbol?: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  orderId?: string
}

// ─── 历史成交结果（含 MAE/MFE 和 K 线） ───
export interface TradeHistoryResult {
  records: Array<{
    id: string
    symbol: string
    side: 'buy' | 'sell'
    entryPrice: number
    exitPrice: number
    realizedPnl: number
    fee: number
    mae: number
    mfe: number
    openedAt: string
    closedAt: string
    orderId: string
    volume: number
  }>
  totalPnl: number
  totalFee: number
  winRate: number
  tradeCount: number
  totalVolume: number
  candles: TradeCandle[]
  markers: Array<{
    time: number
    position: 'aboveBar' | 'belowBar'
    color: string
    shape: 'arrowUp' | 'arrowDown'
    text: string
  }>
}

export interface IExchangeAdapter {
  readonly exchangeId: ExchangeId

  /** 校验 API Key 有效性及权限（只读检查） */
  validateCredentials(
    credentials: ApiCredentials
  ): Promise<CredentialValidation>

  /** 拉取当前 U 本位永续合约持仓 */
  fetchPositions(credentials: ApiCredentials): Promise<UnifiedPosition[]>

  /** 拉取历史成交（不含 K 线，MAE/MFE=0，前端展开时按需加载） */
  fetchTradeHistory(
    credentials: ApiCredentials,
    query: TradeHistoryQuery
  ): Promise<TradeHistoryResult>

  /** 拉取 K 线 */
  fetchKlines(
    credentials: ApiCredentials,
    symbol: string,
    startTime: number,
    endTime: number
  ): Promise<TradeCandle[]>

  /** 按需计算单笔交易的 K 线 + MAE/MFE（前端展开时调用） */
  getTradeCandles(
    credentials: ApiCredentials,
    symbol: string,
    entryPrice: number,
    side: 'buy' | 'sell',
    openedAt: number,
    closedAt: number
  ): Promise<{
    candles: TradeCandle[]
    markers: TradeMarker[]
    mae: number
    mfe: number
  }>
}
