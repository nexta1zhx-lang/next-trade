/**
 * Processor 入口 — 启动事件消费循环
 *
 * 消费 Redis Stream 中的事件，分发到对应的处理器
 */
import {initConsumerGroup, consumeEvents} from '../streams/eventStream.js'
import {handleTradeEvent} from './tradeProcessor.js'
import {
  handlePositionUpdate,
  handleReconciliation
} from './positionProcessor.js'
import type {StreamEvent} from '../streams/eventTypes.js'

let started = false

export async function startProcessors(): Promise<void> {
  if (started) return
  started = true

  await initConsumerGroup()
  console.log('[processor] 消费组已初始化，开始消费事件...')

  // 不阻塞
  consumeEvents(async (event: StreamEvent) => {
    switch (event.type) {
      case 'TRADE_FILLED':
        await handleTradeEvent(event)
        break
      case 'POSITION_UPDATE':
        await handlePositionUpdate(event)
        break
      case 'RECONCILIATION':
        await handleReconciliation(event)
        break
    }
  }).catch(err => {
    console.error('[processor] 消费循环崩溃:', err)
    started = false
  })
}
