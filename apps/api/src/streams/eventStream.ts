/**
 * Redis Streams 事件总线
 *
 * 采集层: XADD → trade_events
 * 计算层: XREADGROUP → 消费 → XACK
 */
import Redis from 'ioredis'
import {
  STREAM_KEY,
  CONSUMER_GROUP,
  CONSUMER_NAME,
  STREAM_MAXLEN,
  type StreamEvent,
  type TradeEvent,
  type PositionUpdateEvent
} from './eventTypes.js'

let redis: Redis | null = null

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379')
    })
  }
  return redis
}

// ─── 生产者: 写入事件 ───

export async function publishTrade(trade: TradeEvent): Promise<string> {
  const r = getRedis()
  const id = await r.xadd(
    STREAM_KEY,
    'MAXLEN',
    '~',
    STREAM_MAXLEN,
    '*',
    'json',
    JSON.stringify(trade)
  )
  return id ?? ''
}

export async function publishPositionUpdate(
  apiKeyId: number,
  symbols?: string[]
): Promise<string> {
  const event: PositionUpdateEvent = {
    type: 'POSITION_UPDATE',
    apiKeyId,
    symbols
  }
  const r = getRedis()
  const id = await r.xadd(
    STREAM_KEY,
    'MAXLEN',
    '~',
    STREAM_MAXLEN,
    '*',
    'json',
    JSON.stringify(event)
  )
  return id ?? ''
}

// ─── 消费者: 初始化消费组 ───

export async function initConsumerGroup(): Promise<void> {
  const r = getRedis()
  try {
    await r.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM')
  } catch (err: any) {
    // BUSYGROUP 表示消费组已存在，正常
    if (!err.message?.includes('BUSYGROUP')) throw err
  }
}

// ─── 消费者: 读取并处理事件 ───

type EventHandler = (event: StreamEvent) => Promise<void>

export async function consumeEvents(
  handler: EventHandler,
  batchSize = 50,
  blockMs = 5000
): Promise<void> {
  const r = getRedis()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const results = (await r.xreadgroup(
        'GROUP',
        CONSUMER_GROUP,
        CONSUMER_NAME,
        'COUNT',
        batchSize,
        'BLOCK',
        blockMs,
        'STREAMS',
        STREAM_KEY,
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
            const event: StreamEvent = JSON.parse(raw)
            await handler(event)
            await r.xack(STREAM_KEY, CONSUMER_GROUP, id)
          } catch (err) {
            console.error('[eventStream] 消费失败:', err, raw.slice(0, 200))
            // 不 ACK，等待重试或死信处理
          }
        }
      }
    } catch (err) {
      console.error('[eventStream] consumeEvents 错误:', err)
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

// ─── 健康检查 ───

export async function getStreamInfo(): Promise<{
  length: number
  pending: number
  consumers: number
}> {
  const r = getRedis()
  const info = (await r.xinfo('STREAM', STREAM_KEY)) as any[]
  const groups = (await r.xinfo('GROUPS', STREAM_KEY)) as any[]

  const length = info?.find((e: any) => e[0] === 'length')?.[1] ?? 0
  const group = groups?.find((g: any) => g[1] === CONSUMER_GROUP)
  const pending = (group as any)?.find((e: any) => e[0] === 'pending')?.[1] ?? 0
  const consumers =
    (group as any)?.find((e: any) => e[0] === 'consumers')?.[1] ?? 0

  return {length, pending, consumers}
}
