import {getRequestListener} from '@hono/node-server'
import {createServer} from 'node:http'
import {WebSocketServer, WebSocket as WsClient} from 'ws'
import {HttpsProxyAgent} from 'https-proxy-agent'
import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {logger} from 'hono/logger'
import cron from 'node-cron'
import {config} from './config.js'
import {redis} from './services/redis.js'
import {dailyAnalysisRouter} from './routes/daily-analysis.js'
import {authRouter} from './routes/auth.js'
import {symbolsRouter} from './routes/symbols.js'
import {v1KeysRouter} from './routes/v1/keys.js'
import {v1TradesRouter} from './routes/v1/trades.js'
import {userConfigRouter} from './routes/user-config.js'
import {favoritesRouter} from './routes/favorites.js'
import {authMiddleware} from './middleware/auth.js'
import {collectAndStore} from './services/dailyMarketService.js'
import {stream} from 'hono/streaming'
import {startBinanceTicker, subscribeTicker} from './services/wsTicker.js'
const app = new Hono()

// ─── 全局中间件 ───
app.use('*', cors({origin: config.CORS_ORIGIN, credentials: true}))
app.use('*', logger())

// ─── 全局错误处理 (确保返回 JSON) ───
app.onError((err, c) => {
  console.error(err)
  return c.json(
    {success: false, error: err.message || 'Internal Server Error'},
    500
  )
})

// ─── 健康检查 ───
app.get('/health', c => c.json({status: 'ok', timestamp: Date.now()}))

// ─── 路由 ───
app.route('/api/daily-analysis', dailyAnalysisRouter)

// ─── 认证路由（公开，带 IP 限流防暴破） ───
app.route('/api/auth', authRouter)

// ─── 币种详情路由（K线 + 标签 + 日记，公开） ───
app.route('/api/symbols', symbolsRouter)

// ─── V1 API Key 管理路由 ───
app.use('/api/v1/keys', authMiddleware)
app.use('/api/v1/keys/*', authMiddleware)
app.route('/api/v1/keys', v1KeysRouter)

// ─── V1 成交查询路由 ───
app.use('/api/v1/trades', authMiddleware)
app.use('/api/v1/trades/*', authMiddleware)
app.route('/api/v1/trades', v1TradesRouter)

// ─── V1 分析路由认证 ───
app.use('/api/v1/analytics/*', authMiddleware)

// ─── 用户配置路由 ───
app.route('/api/user/config', userConfigRouter)

// ─── 自选币种路由（需登录） ───
app.route('/api/favorites', favoritesRouter)

// ─── SSE 行情推送（用于实时盯盘） ───
app.get('/api/ticker/stream', async c => {
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')
  c.header('X-Accel-Buffering', 'no')

  startBinanceTicker()

  return stream(c, async s => {
    const unsubscribe = subscribeTicker(tickers => {
      s.write(`data: ${JSON.stringify(tickers)}\n\n`)
    })
    c.req.raw.signal?.addEventListener('abort', () => unsubscribe())
    // 保持连接直到客户端断开
    await new Promise(() => {})
  })
})

// ─── 启动 ───
async function main() {
  // 连接 Redis
  try {
    await redis.connect()
    console.log('✓ Redis connected')
  } catch {
    console.warn('⚠ Redis unavailable, running without cache')
  }

  const server = createServer()
  const wss = new WebSocketServer({noServer: true})

  // WebSocket 代理：前端连接 /ws → 后端连接 Binance 期货
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`)
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, ws => {
      const symbol = url.searchParams.get('symbol')
      const timeframe = url.searchParams.get('timeframe') ?? '1h'

      if (!symbol) {
        ws.close(4001, 'missing symbol')
        return
      }

      const binanceSymbol = symbol
        .replace('/USDT:USDT', 'USDT')
        .replace('/USDT', 'USDT')
        .replace(':', '')
        .toLowerCase()

      const binanceWs = config.HTTPS_PROXY
        ? new WsClient(
            `wss://fstream.binance.com/market/ws/${binanceSymbol}@kline_1m`,
            {agent: new HttpsProxyAgent(config.HTTPS_PROXY)}
          )
        : new WsClient(
            `wss://fstream.binance.com/market/ws/${binanceSymbol}@kline_1m`
          )

      // Binance 发 ping 时自动回复 pong（ws 库默认行为，显式确保）
      binanceWs.on('ping', (data: Buffer) => {
        if (binanceWs.readyState === binanceWs.OPEN) binanceWs.pong(data)
      })

      binanceWs.on('open', () => {
        console.log(`[ws proxy] connected: ${binanceSymbol}@kline_1m`)
      })

      binanceWs.on('message', (data: Buffer) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data.toString())
        }
      })

      // 任一端断开都关闭另一端
      binanceWs.on('close', () => ws.close())
      binanceWs.on('error', () => binanceWs.close())
      ws.on('close', () => binanceWs.close())
      ws.on('error', () => binanceWs.close())
    })
  })

  server.on('request', getRequestListener(app.fetch))
  server.listen(config.PORT, '0.0.0.0', () => {
    console.log(`✓ API running on http://0.0.0.0:${config.PORT}`)
  })

  // 注册每日行情采集定时任务 (UTC 00:05)
  cron.schedule(
    '5 0 * * *',
    async () => {
      console.log('[Cron] 触发每日行情采集任务...')
      try {
        const result = await collectAndStore()
        console.log(
          `[Cron] 每日行情采集完成: ${result.date}, ${result.count} 条`
        )
      } catch (err) {
        console.error('[Cron] 每日行情采集失败:', err)
      }
    },
    {
      timezone: 'UTC'
    }
  )
  console.log('✓ Daily market data cron registered (UTC 00:05)')

  // 优雅退出（带强制兜底，确保 tsx watch 能正常重启）
  function shutdown() {
    try {
      redis.disconnect()
    } catch {}
    setTimeout(() => process.exit(0), 2000)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
