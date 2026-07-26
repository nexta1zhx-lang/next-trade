/**
 * 成交处理器 — 消费 Redis Stream 中的 TradeEvent，写入 trades 表
 *
 * 职责:
 *   1. 消费 TradeEvent
 *   2. INSERT ON CONFLICT DO NOTHING（幂等去重）
 *   3. 发布 POSITION_UPDATE 事件
 */

import {db} from '../db/index.js'
import {trades} from '../db/schema.js'
import {publishPositionUpdate} from '../streams/eventStream.js'
import type {TradeEvent} from '../streams/eventTypes.js'

export async function handleTradeEvent(event: TradeEvent): Promise<void> {
  const result = await db
    .insert(trades)
    .values({
      apiKeyId: event.apiKeyId,
      tradeId: event.tradeId,
      symbol: event.symbol,
      marketType: event.marketType,
      side: event.side,
      price: event.price,
      amount: event.amount,
      quoteQty: event.quoteQty,
      realizedPnl: event.realizedPnl,
      feeUsdt: event.feeUsdt,
      isLiquidation: event.isLiquidation,
      executedAt: new Date(event.executedAt)
    })
    .onConflictDoNothing()

  // 有新成交才触发仓位更新
  if ((result as any).rowCount > 0) {
    await publishPositionUpdate(event.apiKeyId, [event.symbol])
  }
}
