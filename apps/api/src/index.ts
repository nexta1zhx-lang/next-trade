import {serve} from '@hono/node-server'
import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {logger} from 'hono/logger'
import {config} from './config.js'
import {redis} from './services/redis.js'
import {tickerRouter} from './routes/ticker.js'
import {orderRouter} from './routes/order.js'
import {dailyAnalysisRouter} from './routes/daily-analysis.js'
import {marketRouter} from './routes/market.js'
import {watchlistRouter} from './routes/watchlist.js'
import {streamRouter} from './routes/stream.js'
import {configRouter} from './routes/config.js'
import {authRouter} from './routes/auth.js'
import {tradeAuditRouter} from './routes/trade-audit.js'
import {authMiddleware} from './middleware/auth.js'
import cron from 'node-cron'
import {runDailySync} from './cron/index.js'
import {runDailyWatchlistSync} from './cron/dailySync.js'
import {wsManager} from './services/wsManager.js'
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
app.route('/api/orders', orderRouter)
app.route('/api/market', marketRouter)
app.route('/api/market/watchlist', watchlistRouter)
app.route('/api/stream', streamRouter)
app.route('/api/market/config', configRouter)

// ─── 认证路由（公开，带 IP 限流防暴破） ───
app.route('/api/auth', authRouter)

// ─── 交易审计路由（需要登录） ───
app.use('/api/trade-audit/*', authMiddleware)
app.route('/api/trade-audit', tradeAuditRouter)
// ─── 启动 ───
async function main() {
  // 连接 Redis
  try {
    await redis.connect()
    console.log('✓ Redis connected')
  } catch {
    console.warn('⚠ Redis unavailable, running without cache')
  }

  // 启动 WS 实时监控
  wsManager.start()

  // 启动定时任务（每天 UTC 00:05 自动同步）
  cron.schedule('5 0 * * *', () => {
    runDailySync()
    runDailyWatchlistSync()
  })
  console.log(
    '✓ Cron scheduled: daily volatility sync + watchlist at 00:05 UTC'
  )

  serve({fetch: app.fetch, port: config.PORT}, (info: {port: number}) =>
    console.log(`✓ API running on http://localhost:${info.port}`)
  )

  // 优雅退出（带强制兜底，确保 tsx watch 能正常重启）
  function shutdown() {
    wsManager.stop()
    try {
      redis.disconnect()
    } catch {}
    setTimeout(() => process.exit(0), 2000)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
