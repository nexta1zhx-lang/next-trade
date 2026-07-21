/**
 * 高精度持仓成本与平仓盈亏计算器
 *
 * 严格使用 decimal.js 进行所有数值计算，禁止原生浮点数运算。
 *
 * 功能:
 *   - 现货 BUY → 移动加权平均法更新持仓成本
 *   - 现货 SELL → 计算已实现盈亏并扣除手续费
 *   - 合约加仓 → 方向感知的加权平均成本更新
 *   - 合约平仓 → 盈亏计算 + 手续费扣除
 *   - 仓位反转 → 平仓量超过持仓量时反向建仓
 *
 * 使用方式:
 *   const result = PrecisionPnlCalculator.processTrade(
 *     { amount: new Decimal(0), avgPrice: new Decimal(0) },
 *     { tradeId: 'xxx', side: 'BUY', price: '50000', amount: '0.1', feeUsdt: '0.5', isContract: false }
 *   );
 */

import Decimal from 'decimal.js'

// ─── 全局 Decimal 配置 ───
Decimal.set({precision: 38, rounding: Decimal.ROUND_HALF_UP})

// ─── 类型定义 ───

/** 成交记录输入 */
export interface TradeInput {
  /** 交易所原始成交 ID */
  tradeId: string
  /**
   * 成交方向:
   *   现货: 'BUY' | 'SELL'
   *   合约: 'BUY' (开多/平空) | 'SELL' (开空/平多)
   */
  side: 'BUY' | 'SELL'
  /** 成交价（string 避免精度丢失） */
  price: string | number
  /** 成交数量 */
  amount: string | number
  /** 已折算为 USDT 的手续费 */
  feeUsdt: string | number
  /** 是否为合约（false = 现货） */
  isContract: boolean
}

/** 持仓状态（使用 Decimal 确保精度） */
export interface PositionState {
  /** 持仓量: 正数=多头, 负数=空头, 零=空仓 */
  amount: Decimal
  /** 持仓均价 */
  avgPrice: Decimal
}

/** processTrade 返回值 */
export interface ProcessTradeResult {
  /** 本次成交产生的已实现盈亏（USDT，字符串保留 8 位精度） */
  realizedPnlUsdt: string
  /** 更新后的持仓状态 */
  positionAfter: PositionState
}

// ═══════════════════════════════════════════
// 核心计算器
// ═══════════════════════════════════════════

export class PrecisionPnlCalculator {
  /**
   * 处理单笔成交，返回已实现盈亏和更新后的持仓状态。
   *
   * @param currentPos  当前持仓（调用方维护）
   * @param trade       当前成交记录
   * @returns           已实现盈亏 + 新持仓状态
   */
  static processTrade(
    currentPos: PositionState,
    trade: TradeInput
  ): ProcessTradeResult {
    const tradePrice = new Decimal(trade.price)
    const tradeQty = new Decimal(trade.amount)
    const feeUsdt = new Decimal(trade.feeUsdt)

    let posQty = currentPos.amount
    let posAvgPrice = currentPos.avgPrice
    let realizedPnlUsdt = new Decimal(0)

    if (!trade.isContract) {
      // ─── 现货逻辑 ───
      const result = this._processSpot(
        posQty,
        posAvgPrice,
        trade.side,
        tradePrice,
        tradeQty,
        feeUsdt
      )
      posQty = result.posQty
      posAvgPrice = result.posAvgPrice
      realizedPnlUsdt = result.realizedPnlUsdt
    } else {
      // ─── 合约逻辑 ───
      const result = this._processContract(
        posQty,
        posAvgPrice,
        trade.side,
        tradePrice,
        tradeQty,
        feeUsdt
      )
      posQty = result.posQty
      posAvgPrice = result.posAvgPrice
      realizedPnlUsdt = result.realizedPnlUsdt
    }

    return {
      realizedPnlUsdt: realizedPnlUsdt.toFixed(8),
      positionAfter: {
        amount: posQty,
        avgPrice: posAvgPrice
      }
    }
  }

  // ─── 现货处理 ───
  private static _processSpot(
    posQty: Decimal,
    posAvgPrice: Decimal,
    side: 'BUY' | 'SELL',
    tradePrice: Decimal,
    tradeQty: Decimal,
    feeUsdt: Decimal
  ) {
    let realizedPnlUsdt = new Decimal(0)

    if (side === 'BUY') {
      // 买入: 移动加权平均法更新成本
      // 总成本 = 原持仓市值 + 本次买入额
      const totalCost = posQty.mul(posAvgPrice).add(tradeQty.mul(tradePrice))
      posQty = posQty.add(tradeQty)
      posAvgPrice = posQty.gt(0) ? totalCost.div(posQty) : new Decimal(0)
    } else {
      // 卖出: 结算盈亏
      // 平仓量不超过当前持仓
      const closeQty = Decimal.min(posQty, tradeQty)
      // 盈亏 = 平仓量 × (卖出价 - 成本价) - 手续费
      realizedPnlUsdt = closeQty.mul(tradePrice.sub(posAvgPrice)).sub(feeUsdt)
      posQty = Decimal.max(0, posQty.sub(tradeQty))
      if (posQty.isZero()) {
        posAvgPrice = new Decimal(0)
      }
    }

    return {posQty, posAvgPrice, realizedPnlUsdt}
  }

  // ─── 合约处理 ───
  private static _processContract(
    posQty: Decimal,
    posAvgPrice: Decimal,
    side: 'BUY' | 'SELL',
    tradePrice: Decimal,
    tradeQty: Decimal,
    feeUsdt: Decimal
  ) {
    const isLong = posQty.gt(0) // 当前多头
    const isShort = posQty.lt(0) // 当前空头
    const isBuy = side === 'BUY'
    let realizedPnlUsdt = new Decimal(0)

    // 判断是加仓还是平仓:
    //   - 空仓时首次开仓 → 加仓
    //   - 多头 + BUY → 加仓
    //   - 空头 + SELL → 加仓
    //   否则 → 平仓（方向相反）
    const isIncreasing =
      posQty.isZero() || (isLong && isBuy) || (isShort && !isBuy)

    if (isIncreasing) {
      // ── 加仓: 更新加权平均成本 ──
      const deltaQty = isBuy ? tradeQty : tradeQty.neg()
      const newQty = posQty.add(deltaQty)

      // 总成本 = |原持仓| × 原均价 + 本次成交量 × 成交价
      const totalCost = posQty
        .abs()
        .mul(posAvgPrice)
        .add(tradeQty.mul(tradePrice))
      posAvgPrice = totalCost.div(newQty.abs())
      posQty = newQty
    } else {
      // ── 平仓: 计算盈亏并扣除手续费 ──
      // 平仓量不超过当前持仓绝对值
      const closeQty = Decimal.min(posQty.abs(), tradeQty)
      // 方向因子: 多头=1, 空头=-1
      const pnlDirection = isLong ? new Decimal(1) : new Decimal(-1)

      // 盈亏 = 平仓量 × (平仓价 - 成本价) × 方向 - 手续费
      realizedPnlUsdt = closeQty
        .mul(tradePrice.sub(posAvgPrice))
        .mul(pnlDirection)
        .sub(feeUsdt)

      // 计算剩余持仓量
      const remainingQty = posQty.abs().sub(tradeQty)

      if (remainingQty.gt(0)) {
        // 部分平仓: 剩余量保持原方向
        posQty = isLong ? remainingQty : remainingQty.neg()
      } else if (remainingQty.isZero()) {
        // 完全平仓: 归零
        posQty = new Decimal(0)
        posAvgPrice = new Decimal(0)
      } else {
        // 仓位反转 (Over-turn): 平仓量超出持仓量，多余部分反向建仓
        // remainingQty 此时为负数，取其绝对值作为反向数量
        const overTurnQty = remainingQty.neg()
        posQty = isBuy ? overTurnQty : overTurnQty.neg()
        // 反向仓位成本重置为本次成交价
        posAvgPrice = tradePrice
      }
    }

    return {posQty, posAvgPrice, realizedPnlUsdt}
  }
}
