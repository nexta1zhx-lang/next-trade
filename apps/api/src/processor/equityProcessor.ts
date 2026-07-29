/**
 * 权益处理器 — 消费 equity_events 流
 *
 * 职责:
 *   1. 消费 EQUITY_UPDATE → processWsEquityUpdate (Redis 实时更新)
 *   2. 消费 EQUITY_RECONCILE → processRestReconcile (Redis + baseline 更新)
 *   3. 维护在线/离线状态跟踪
 *
 * 防爆处理:
 *   同一 apiKeyId 的 WS 事件在 1 秒内仅保留最后一次，防止高频洪峰
 */

import {
  processWsEquityUpdate,
  processRestReconcile
} from '../services/equityTracker.js'
import type {
  EquityUpdateEvent,
  EquityReconcileEvent
} from '../streams/eventTypes.js'

// ─── WS 防爆去抖 ───
// 同一 Key 的 EQUITY_UPDATE 在 WINDOW_MS 内只执行最后一次
const DEBOUNCE_WINDOW_MS = 1_000
const debounceMap = new Map<number, EquityUpdateEvent>()
const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>()

function debouncedProcess(event: EquityUpdateEvent): void {
  const {apiKeyId} = event
  // 覆盖之前的数据（只保留最新）
  debounceMap.set(apiKeyId, event)

  const existing = debounceTimers.get(apiKeyId)
  if (existing) clearTimeout(existing)

  debounceTimers.set(
    apiKeyId,
    setTimeout(async () => {
      debounceTimers.delete(apiKeyId)
      const latest = debounceMap.get(apiKeyId)
      debounceMap.delete(apiKeyId)
      if (!latest) return

      try {
        await processWsEquityUpdate(
          latest.apiKeyId,
          parseFloat(latest.futuresWallet),
          parseFloat(latest.unrealizedPnl),
          latest.eventTime
        )
      } catch (err) {
        console.error(
          `[equityProcessor] WS 权益更新失败 key=${latest.apiKeyId}:`,
          (err as Error).message
        )
      }
    }, DEBOUNCE_WINDOW_MS)
  )
}

/**
 * 处理 WS 推送的权益更新事件
 */
export async function handleEquityUpdate(
  event: EquityUpdateEvent
): Promise<void> {
  debouncedProcess(event)
}

/**
 * 处理 REST 校准事件（离线或周期校准）
 */
export async function handleEquityReconcile(
  event: EquityReconcileEvent
): Promise<void> {
  const {apiKeyId, futuresWallet, unrealizedPnl, fundingUsdt} = event

  // REST 校准不需要去抖，优先级高于 WS
  try {
    await processRestReconcile(
      apiKeyId,
      parseFloat(futuresWallet),
      parseFloat(unrealizedPnl),
      parseFloat(fundingUsdt)
    )
  } catch (err) {
    console.error(
      `[equityProcessor] REST 校准失败 key=${apiKeyId}:`,
      (err as Error).message
    )
  }
}
