/**
 * 仓位处理器 — 消费 Redis Stream 中的 POSITION_UPDATE 事件
 *
 * 职责:
 *   1. 消费 POSITION_UPDATE → 调用 syncPositionsFromTrades
 *   2. 消费 RECONCILIATION → 全量重算
 *   3. 去抖动：同一 apiKeyId 的多次更新合并处理
 */

import {syncPositionsFromTrades} from '../services/positionService.js'
import type {
  PositionUpdateEvent,
  ReconciliationEvent
} from '../streams/eventTypes.js'

// 去抖: 30 秒内同一 Key 只处理一次
const debounceMap = new Map<number, ReturnType<typeof setTimeout>>()
const DEBOUNCE_MS = 30_000

export async function handlePositionUpdate(
  event: PositionUpdateEvent
): Promise<void> {
  const {apiKeyId} = event

  // 去抖
  const existing = debounceMap.get(apiKeyId)
  if (existing) clearTimeout(existing)

  debounceMap.set(
    apiKeyId,
    setTimeout(async () => {
      debounceMap.delete(apiKeyId)
      try {
        await syncPositionsFromTrades(apiKeyId)
        console.log(`[positionProcessor] 仓位重算完成: key=${apiKeyId}`)
      } catch (err) {
        console.error(`[positionProcessor] 仓位重算失败: key=${apiKeyId}`, err)
      }
    }, DEBOUNCE_MS)
  )
}

export async function handleReconciliation(
  event: ReconciliationEvent
): Promise<void> {
  const {apiKeyId} = event
  // 对账事件立即执行，不去抖
  try {
    await syncPositionsFromTrades(apiKeyId)
    console.log(`[positionProcessor] 对账完成: key=${apiKeyId}`)
  } catch (err) {
    console.error(`[positionProcessor] 对账失败: key=${apiKeyId}`, err)
  }
}
