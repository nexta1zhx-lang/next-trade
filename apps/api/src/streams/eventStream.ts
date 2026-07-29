/**
 * Redis Streams 事件总线
 *
 * 采集层: XADD → trade_events
 * 计算层: XREADGROUP → 消费 → XACK
 */
import Redis from 'ioredis'
import {config} from '../config.js'
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
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true
    })
    redis.on('error', err => {
      console.warn('[eventStream redis] connection error:', err.message)
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

// 背压监控：当 pending 消息超过此阈值时暂停消费
const BACKPRESSURE_THRESHOLD = 10_000
// 背压恢复后等待的轮次数
const BACKPRESSURE_RECOVERY_ROUNDS = 3

let consecutiveEmptyReads = 0

async function checkBackpressure(r: import('ioredis').Redis): Promise<boolean> {
  try {
    const info = (await r.xinfo('STREAM', STREAM_KEY)) as any[]
    const length = info?.find((e: any) => e[0] === 'length')?.[1] ?? 0
    if (length > BACKPRESSURE_THRESHOLD) {
      console.warn(
        `[eventStream] 背压警告: Stream 堆积 ${length} 条(阈值 ${BACKPRESSURE_THRESHOLD})，暂停消费 10s`
      )
      await new Promise(r => setTimeout(r, 10_000))
      return true // 已等待，继续
    }
  } catch {}
  return false
}

export async function consumeEvents(
  handler: EventHandler,
  batchSize = 50,
  blockMs = 5000
): Promise<void> {
  const r = getRedis()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // 背压检查：每 10 轮空读检查一次 pending 数量
      if (consecutiveEmptyReads > 0 && consecutiveEmptyReads % 10 === 0) {
        const backpressured = await checkBackpressure(r)
        if (backpressured) continue
      }

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

      if (!results) {
        consecutiveEmptyReads++
        continue
      }
      consecutiveEmptyReads = 0

      for (const [, messages] of results) {
        // 如果一次拉取超过 80% batchSize，说明积压严重，动态减小 batchSize
        const currentBatchSize =
          messages.length > batchSize * 0.8 && batchSize > 10
            ? Math.max(10, Math.floor(batchSize / 2))
            : Math.min(50, batchSize + 5)

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
