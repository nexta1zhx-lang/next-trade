/**
 * 交易所数据标准化映射器
 *
 * 将各交易所原始成交数据统一映射为系统标准格式:
 *   - 交易对: BTCUSDT → BTC/USDT
 *   - 方向:   buy → BUY / OPEN_LONG, sell → SELL / CLOSE_SHORT
 *   - 时间:   统一 UTC
 *   - 手续费: 多币种折算为 USDT
 *   - 强平:   自动标记
 */

import Decimal from 'decimal.js'

// ─── 标准化交易方向枚举 ───
export type StandardSide =
  | 'BUY' // 现货买入
  | 'SELL' // 现货卖出
  | 'OPEN_LONG' // 合约开多
  | 'CLOSE_LONG' // 合约平多
  | 'OPEN_SHORT' // 合约开空
  | 'CLOSE_SHORT' // 合约平空

// ─── 市场类型 ───
export type MarketType = 'SPOT' | 'PERP' | 'FUTURES'

// ─── 标准化后的成交记录 ───
export interface NormalizedTrade {
  apiKeyId: number
  tradeId: string
  symbol: string
  marketType: MarketType
  side: StandardSide
  price: string
  amount: string
  quoteQty: string
  realizedPnl: string
  feeUsdt: string
  isLiquidation: boolean
  executedAt: Date
}

/**
 * 标准化交易对
 *
 * 输入: BTCUSDT, BTC/USDT, BTC/USDT:USDT, BTC-USD
 * 输出: BTC/USDT
 */
export function normalizeSymbol(raw: string): string {
  let s = raw.toUpperCase().trim()
  // 去除杠杆后缀 :USDT :USD
  s = s.replace(/:USD.*$/, '')
  // ETH-USD → ETH/USDT (统一使用 USDT 报价)
  s = s.replace(/-USD$/, '/USDT')
  s = s.replace(/-USDT$/, '/USDT')
  // 如果包含 / 但报价币不是 USDT → 转为 USDT 对
  if (s.includes('/') && !s.endsWith('USDT')) {
    const [base] = s.split('/')
    s = `${base}/USDT`
  }
  // 无分隔符: BTCUSDT → BTC/USDT
  if (!s.includes('/')) {
    // 尝试从末尾匹配 USDT
    if (s.endsWith('USDT') && s.length > 4) {
      const base = s.slice(0, -4)
      s = `${base}/USDT`
    }
  }
  return s
}

/**
 * 标准化交易方向
 *
 * CCXT 返回的原始 side 通常是 'buy'/'sell'。
 * 合约需要结合 positionSide ('long'/'short') 或持仓变化推断真实动作。
 */
export function normalizeSide(
  side: 'buy' | 'sell',
  isContract: boolean,
  /** 合约持仓变化前的方向（用于推断平仓/开仓） */
  positionSide?: 'long' | 'short' | null,
  /** 是否为减仓 */
  isReduce?: boolean
): StandardSide {
  if (!isContract) {
    return side === 'buy' ? 'BUY' : 'SELL'
  }

  // 合约方向推断
  if (isReduce) {
    // 明确为减仓
    if (positionSide === 'long' || side === 'sell') {
      return side === 'sell' ? 'CLOSE_LONG' : 'CLOSE_SHORT'
    }
    return side === 'buy' ? 'CLOSE_SHORT' : 'CLOSE_LONG'
  }

  // 根据 positionSide 推断
  if (positionSide === 'long') {
    return side === 'buy' ? 'OPEN_LONG' : 'CLOSE_LONG'
  }
  if (positionSide === 'short') {
    return side === 'sell' ? 'OPEN_SHORT' : 'CLOSE_SHORT'
  }

  // 无法推断时，按 side 默认
  return side === 'buy' ? 'OPEN_LONG' : 'OPEN_SHORT'
}

/**
 * 检测是否为强平单
 *
 * 各交易所强平标记方式不同:
 *   Binance: 订单类型为 LIQUIDATION
 *   OKX:     trade 包含 liquidation 标记
 */
export function detectLiquidation(ccxtTrade: any): boolean {
  if (ccxtTrade.info?.type === 'LIQUIDATION') return true
  if (ccxtTrade.info?.liquidation) return true
  if (ccxtTrade.info?.isLiquidation) return true
  if (ccxtTrade.info?.orderType === 'LIQUIDATION') return true
  return false
}

/**
 * 折算手续费为 USDT
 *
 * 如果手续费币种不是 USDT，尝试用成交时的价格折算:
 *   fee = amount / price
 * 如果无法折算则返回 "0"
 */
export function convertFeeToUsdt(
  fee: string | number | undefined,
  feeCurrency: string | undefined,
  tradePrice: string | number
): string {
  if (!fee || new Decimal(fee).isZero()) return '0'

  const feeStr = String(fee)
  const currency = (feeCurrency ?? 'USDT').toUpperCase()

  if (currency === 'USDT') return feeStr

  // 非 USDT 手续费: 用成交价折算 fee_coin → USDT
  try {
    const feeDecimal = new Decimal(feeStr)
    const price = new Decimal(tradePrice)
    return feeDecimal.mul(price).toFixed(8)
  } catch {
    return '0'
  }
}

/**
 * 完整标准化一笔成交
 *
 * @param apiKeyId  关联的 API Key ID
 * @param trade     CCXT 返回的原始 trade 对象
 * @param isContract 是否为合约
 */
export function normalizeTrade(
  apiKeyId: number,
  trade: any,
  isContract: boolean
): NormalizedTrade {
  const rawSymbol = trade.symbol ?? trade.info?.symbol ?? ''
  const side: 'buy' | 'sell' = trade.side ?? 'buy'
  const positionSide = trade.info?.positionSide?.toLowerCase() as
    | 'long'
    | 'short'
    | undefined

  // 判断是否为减仓（部分交易所标记）
  const isReduce = trade.info?.reduceOnly ?? false

  const price = trade.price ?? 0
  const amount = trade.amount ?? 0

  // 名义成交金额
  const quoteQty = trade.cost ?? new Decimal(price).mul(amount).toNumber()

  // 已实现盈亏（合约才有）
  const realizedPnl = trade.realizedPnl ?? 0

  // 手续费
  const fee = trade.fee?.cost
  const feeCurrency = trade.fee?.currency
  const feeUsdt = convertFeeToUsdt(fee, feeCurrency, price)

  // 市场类型推断
  const marketType: MarketType = isContract ? 'PERP' : 'SPOT'

  // 成交时间
  const executedAt = trade.timestamp ? new Date(trade.timestamp) : new Date()

  return {
    apiKeyId,
    tradeId: String(trade.id ?? trade.tradeId ?? ''),
    symbol: normalizeSymbol(rawSymbol),
    marketType,
    side: normalizeSide(side, isContract, positionSide, isReduce),
    price: String(price),
    amount: String(amount),
    quoteQty: String(quoteQty),
    realizedPnl: String(realizedPnl),
    feeUsdt,
    isLiquidation: detectLiquidation(trade),
    executedAt
  }
}
