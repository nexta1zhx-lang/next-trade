import {getRequestListener} from '@hono/node-server'
import {createServer} from 'node:http'
import {WebSocketServer, WebSocket as WsClient} from 'ws'
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
import {v1PositionsRouter} from './routes/v1/positions.js'
import {userConfigRouter} from './routes/user-config.js'
import {favoritesRouter} from './routes/favorites.js'
import {publishRouter} from './routes/publish.js'
import {assetRouter} from './routes/asset.js'
import {assetQueue} from './services/assetQueue.js'
import {authMiddleware} from './middleware/auth.js'
import {collectAndStore} from './services/dailyMarketService.js'
import {enqueueAllSnapshots} from './services/assetQueue.js'
import {aggregateDailySummary} from './services/assetService.js'
import {db} from './db/index.js'
import {apiKeys} from './db/schema.js'
import {eq, and} from 'drizzle-orm'
import {startBinanceTicker, subscribeTicker} from './services/wsTicker.js'
import {subscribeClient, unsubscribeClient} from './services/wsUserData.js'
import {incrementalSync} from './services/tradeSyncService.js'
import {verifyToken} from './services/auth.js'
import {startProcessors} from './processor/index.js'
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

// ─── V1 合约仓位路由 ───
app.use('/api/v1/positions', authMiddleware)
app.use('/api/v1/positions/*', authMiddleware)
app.route('/api/v1/positions', v1PositionsRouter)

// ─── V1 分析路由认证 ───
app.use('/api/v1/analytics/*', authMiddleware)

// ─── 用户配置路由 ───
app.route('/api/user/config', userConfigRouter)

// ─── 自选币种路由（需登录） ───
app.route('/api/favorites', favoritesRouter)

// ─── 发布订阅路由（需登录） ───
app.use('/api/v1/publish', authMiddleware)
app.use('/api/v1/publish/*', authMiddleware)
app.route('/api/v1/publish', publishRouter)

// ─── 资产快照路由（需登录） ───
app.use('/api/asset/*', authMiddleware)
app.route('/api/asset', assetRouter)

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

  // WebSocket：前端连接 /ws（K线）或 /ws/ticker（全量行情推送）
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`)

    // /ws/ticker — 推送全量 ticker 数据（所有币种实时行情）
    if (url.pathname === '/ws/ticker') {
      startBinanceTicker()
      wss.handleUpgrade(req, socket, head, ws => {
        console.log('[ws ticker] client connected')
        const unsubscribe = subscribeTicker(tickers => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(tickers))
          }
        })
        ws.on('close', () => {
          console.log('[ws ticker] client disconnected')
          unsubscribe()
        })
        ws.on('error', () => unsubscribe())
      })
      return
    }

    // /ws/user — 用户数据流代理（按需连接）
    if (url.pathname === '/ws/user') {
      const token = url.searchParams.get('token')
      if (!token) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, ws => {
        if (!token) {
          ws.close(4001, 'missing token')
          return
        }
        verifyToken(token)
          .then(async claims => {
            if (!claims?.sub) {
              ws.close(4001, 'invalid token')
              return
            }
            const userId = parseInt(claims.sub)
            const keys = await db
              .select({id: apiKeys.id})
              .from(apiKeys)
              .where(
                and(
                  eq(apiKeys.userId, userId),
                  eq(apiKeys.exchangeId, 'binance'),
                  eq(apiKeys.status, 'ACTIVE')
                )
              )
              .limit(1)
            if (!keys.length) {
              ws.close(4001, 'no active key')
              return
            }
            const keyId = keys[0].id
            const ok = await subscribeClient(keyId, ws)
            if (!ok) {
              ws.close(4001, 'subscribe failed')
              return
            }
            ws.on('close', () => unsubscribeClient(keyId, ws))
            ws.on('error', () => unsubscribeClient(keyId, ws))
          })
          .catch(() => ws.close(4001, 'auth failed'))
      })
      return
    }

    // /ws — K 线代理（单币种）
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

      const binanceWs = new WsClient(
        `wss://fstream.binance.com/market/ws/${binanceSymbol}@kline_1m`
      )

      // Binance 发 ping 时自动回复 pong（ws 库默认行为，显式确保）
      binanceWs.on('ping', (data: Buffer) => {
        if (binanceWs.readyState === binanceWs.OPEN) binanceWs.pong(data)
      })

      binanceWs.on('open', () => {
        console.log(`[ws kline] connected: ${binanceSymbol}@kline_1m`)
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

  // 启动事件处理器（消费 Redis Streams）
  startProcessors().then(() => {
    console.log('✓ Event processors started')
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

  // 注册每小时资产快照采集 (BullMQ 重复任务)
  await assetQueue.upsertJobScheduler(
    'hourly-snapshot',
    {pattern: '0 * * * *'},
    {name: 'batch-snapshot', data: {}}
  )
  console.log('✓ Hourly asset snapshot scheduler registered')

  // 注册每日资产聚合任务 (UTC 00:01)
  cron.schedule(
    '1 0 * * *',
    async () => {
      console.log('[Cron] 触发每日资产聚合任务...')
      try {
        const yesterday = new Date()
        yesterday.setUTCDate(yesterday.getUTCDate() - 1)
        const dateStr = yesterday.toISOString().slice(0, 10)

        const keys = await db
          .select({id: apiKeys.id})
          .from(apiKeys)
          .where(
            and(eq(apiKeys.exchangeId, 'binance'), eq(apiKeys.status, 'ACTIVE'))
          )

        for (const key of keys) {
          try {
            await aggregateDailySummary(key.id, dateStr)
          } catch (err) {
            console.error(
              `[Cron] 聚合 key=${key.id} 失败:`,
              (err as Error).message
            )
          }
        }
        console.log(`[Cron] 每日资产聚合完成: ${keys.length} 个 Key`)
      } catch (err) {
        console.error('[Cron] 每日资产聚合失败:', err)
      }
    },
    {
      timezone: 'UTC'
    }
  )
  console.log('✓ Daily asset aggregation cron registered (UTC 00:01')

  // 优雅退出（带强制兜底，确保 tsx watch 能正常重启）
  function shutdown() {
    try {
      assetQueue.close()
    } catch {}
    try {
      redis.disconnect()
    } catch {}
    setTimeout(() => process.exit(0), 2000)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
