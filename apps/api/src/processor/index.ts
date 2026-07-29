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
import {handleEquityUpdate, handleEquityReconcile} from './equityProcessor.js'
import type {StreamEvent} from '../streams/eventTypes.js'
import {
  EQUITY_STREAM_KEY,
  EQUITY_CONSUMER_GROUP,
  EQUITY_CONSUMER_NAME,
  EQUITY_STREAM_MAXLEN
} from '../streams/eventTypes.js'
import Redis from 'ioredis'
import {config} from '../config.js'

let started = false
let equityStarted = false

export async function startProcessors(): Promise<void> {
  if (started) return
  started = true

  await initConsumerGroup()
  console.log('[processor] trade_events 消费组已初始化，开始消费事件...')

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

  // 启动权益事件消费
  startEquityProcessor().catch(err => {
    console.error('[processor] 权益消费启动失败:', err)
  })
}

/**
 * 启动权益事件消费循环（独立流，独立连接）
 */
async function startEquityProcessor(): Promise<void> {
  if (equityStarted) return
  equityStarted = true

  const redisEquity = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true
  })
  redisEquity.on('error', err => {
    console.warn('[equityProcessor redis] connection error:', err.message)
  })

  // 创建消费组
  try {
    await redisEquity.xgroup(
      'CREATE',
      EQUITY_STREAM_KEY,
      EQUITY_CONSUMER_GROUP,
      '0',
      'MKSTREAM'
    )
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err
  }

  console.log('[processor] equity_events 消费组已初始化')

  // 消费循环
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const results = (await redisEquity.xreadgroup(
        'GROUP',
        EQUITY_CONSUMER_GROUP,
        EQUITY_CONSUMER_NAME,
        'COUNT',
        20,
        'BLOCK',
        5000,
        'STREAMS',
        EQUITY_STREAM_KEY,
        '>'
      )) as [string, [string, string[]][]][] | null

      if (!results) continue

      for (const [, messages] of results) {
        for (const [id, fields] of messages) {
          const jsonIdx = fields.indexOf('json')
          if (jsonIdx < 0) continue
          const raw = fields[jsonIdx + 1]
          if (!raw) continue

          try {
            const event = JSON.parse(raw)
            if (event.type === 'EQUITY_UPDATE') {
              await handleEquityUpdate(event)
            } else if (event.type === 'EQUITY_RECONCILE') {
              await handleEquityReconcile(event)
            }
            await redisEquity.xack(EQUITY_STREAM_KEY, EQUITY_CONSUMER_GROUP, id)
          } catch (err) {
            console.error(
              '[equityProcessor] 消费失败:',
              err,
              (raw as string).slice(0, 200)
            )
          }
        }
      }
    } catch (err) {
      console.error('[equityProcessor] consumeEvents 错误:', err)
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}
