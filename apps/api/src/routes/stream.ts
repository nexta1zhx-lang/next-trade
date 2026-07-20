import {Hono} from 'hono'
import {streamSSE} from 'hono/streaming'
import {redis} from '../services/redis.js'

const router = new Hono()

/**
 * GET /api/stream/alerts
 *
 * SSE 推送实时告警事件
 * 前端使用: new EventSource('/api/stream/alerts')
 */
router.get('/alerts', c => {
  return streamSSE(c, async stream => {
    // 发送初始连接成功事件
    await stream.writeSSE({
      data: JSON.stringify({type: 'connected', timestamp: Date.now()})
    })

    // Redis SUBSCRIBE
    const subscriber = redis.duplicate()
    let unsubscribed = false

    try {
      await subscriber.connect()
      await subscriber.subscribe('channel:market_alerts')
    } catch (err) {
      console.error('[stream] Redis subscriber error:', (err as Error).message)
      return
    }

    // 监听消息
    const onMessage = (_channel: string, message: string) => {
      if (unsubscribed) return
      stream.writeSSE({event: 'alert', data: message})
    }

    subscriber.on('message', onMessage)

    // 客户端断开时清理
    c.req.raw.signal.addEventListener('abort', () => {
      unsubscribed = true
      subscriber.removeListener('message', onMessage)
      subscriber.unsubscribe('channel:market_alerts')
      subscriber.disconnect()
    })

    // 保持 SSE 连接
    while (!unsubscribed) {
      await stream.sleep(5000)
    }
  })
})

export {router as streamRouter}
