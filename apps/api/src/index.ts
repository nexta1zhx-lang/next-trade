import {serve} from '@hono/node-server'
import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {logger} from 'hono/logger'
import cron from 'node-cron'
import {config} from './config.js'
import {redis} from './services/redis.js'
import {tickerRouter} from './routes/ticker.js'
import {dailyAnalysisRouter} from './routes/daily-analysis.js'
import {authRouter} from './routes/auth.js'
import {symbolsRouter} from './routes/symbols.js'
import {v1KeysRouter} from './routes/v1/keys.js'
import {v1TradesRouter} from './routes/v1/trades.js'
import {authMiddleware} from './middleware/auth.js'
import {collectAndStore} from './services/dailyMarketService.js'
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
app.route('/api/ticker', tickerRouter)
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

// ─── 启动 ───
async function main() {
  // 连接 Redis
  try {
    await redis.connect()
    console.log('✓ Redis connected')
  } catch {
    console.warn('⚠ Redis unavailable, running without cache')
  }

  serve({fetch: app.fetch, port: config.PORT}, (info: {port: number}) =>
    console.log(`✓ API running on http://localhost:${info.port}`)
  )

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
