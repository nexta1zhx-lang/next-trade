import {serve} from '@hono/node-server'
import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {logger} from 'hono/logger'
import {config} from './config.js'
import {redis} from './services/redis.js'
import {tickerRouter} from './routes/ticker.js'
import {dailyAnalysisRouter} from './routes/daily-analysis.js'
import {authRouter} from './routes/auth.js'
import {tradeAuditRouter} from './routes/trade-audit.js'
import {v1KeysRouter} from './routes/v1/keys.js'
import {v1TradesRouter} from './routes/v1/trades.js'
import {v1SyncRouter} from './routes/v1/sync.js'
import {equityRouter} from './routes/v1/analytics/equity.js'
import {authMiddleware} from './middleware/auth.js'
import cron from 'node-cron'
import {startSnapshotScheduler} from './services/sync/scheduler.js'
import {collectAllCapitalFlows} from './services/sync/capitalFlowService.js'
import {aggregateAllDailySnapshots} from './services/sync/dailyAggregationService.js'
import {reconstructHistoricalEquity} from './services/sync/historicalReconstruction.js'
import {invalidateEquityCache} from './services/analytics/equityService.js'
import {apiKeys} from './db/schema.js'
import {eq} from 'drizzle-orm'
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

// ─── 交易审计路由（需要登录） ───
app.use('/api/trade-audit/*', authMiddleware)
app.route('/api/trade-audit', tradeAuditRouter)

// ─── V1 API Key 管理路由 ───
app.use('/api/v1/keys', authMiddleware)
app.use('/api/v1/keys/*', authMiddleware)
app.route('/api/v1/keys', v1KeysRouter)

// ─── V1 成交查询路由 ───
app.use('/api/v1/trades', authMiddleware)
app.use('/api/v1/trades/*', authMiddleware)
app.route('/api/v1/trades', v1TradesRouter)

// ─── V1 同步路由 ───
app.use('/api/v1/sync', authMiddleware)
app.use('/api/v1/sync/*', authMiddleware)
app.route('/api/v1/sync', v1SyncRouter)

// ─── V1 资金曲线路由 ───
app.use('/api/v1/analytics/*', authMiddleware)
app.route('/api/v1/analytics/equity-curve', equityRouter)
// ─── 启动时为已有 Key 自动补齐历史数据 ───
async function reconstructExistingKeys(): Promise<void> {
  try {
    const {db} = await import('./db/index.js')
    const {assetSnapshots} = await import('./db/schema.js')
    const {sql} = await import('drizzle-orm')

    // 找无日级快照的 ACTIVE Key
    const keys = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId
      })
      .from(apiKeys)
      .where(eq(apiKeys.status, 'ACTIVE'))

    for (const key of keys) {
      // 检查是否已有日级快照
      const [existing] = await db
        .select({id: assetSnapshots.id})
        .from(assetSnapshots)
        .where(eq(assetSnapshots.apiKeyId, key.id))
        .limit(1)

      if (!existing) {
        // 不 await，后台执行
        reconstructHistoricalEquity(key.id, key.userId, 90)
      }
    }
  } catch {
    // 静默失败
  }
}

// ─── 启动 ───
async function main() {
  // 连接 Redis
  try {
    await redis.connect()
    console.log('✓ Redis connected')
  } catch {
    console.warn('⚠ Redis unavailable, running without cache')
  }

  // 启动余额快照（每 5 分钟）
  startSnapshotScheduler()

  // ─── 定时任务 ───

  // 每天 UTC 00:01 (北京时间 08:01): 日级资产快照聚合
  cron.schedule('1 0 * * *', async () => {
    await aggregateAllDailySnapshots()
  })
  console.log('✓ Cron scheduled: daily snapshot aggregation at 00:01 UTC')

  // 每整点 (UTC): 出入金流水采集
  cron.schedule('0 * * * *', async () => {
    await collectAllCapitalFlows()
  })
  console.log('✓ Cron scheduled: capital flow collection every hour')

  // ─── 启动时为已有 Key 补齐历史数据（仅无 asset_snapshots 的 Key） ───
  reconstructExistingKeys()

  serve({fetch: app.fetch, port: config.PORT}, (info: {port: number}) =>
    console.log(`✓ API running on http://localhost:${info.port}`)
  )

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
