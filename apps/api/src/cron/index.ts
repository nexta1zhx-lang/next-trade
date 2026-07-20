import {syncVolatilityRank} from '../services/contractSync.js'

/**
 * 定时任务入口
 *
 * 使用 node-cron 在 API 进程内轻量调度:
 * ```
 * import cron from 'node-cron'
 * import {runDailySync} from './cron/index.js'
 *
 * cron.schedule('5 0 * * *', runDailySync) // 每天 UTC 00:05
 * ```
 *
 * 也可以手动触发: curl -X POST http://localhost:3001/api/market/contract-volatility/sync
 */
export async function runDailySync(): Promise<void> {
  const start = Date.now()
  console.log(
    `[cron] Starting daily volatility sync at ${new Date().toISOString()}`
  )

  try {
    const result = await syncVolatilityRank('binance')
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(
      `[cron] ✓ Binance volatility sync complete in ${elapsed}s. ` +
        `TOP 1: ${result.top[0]?.symbol ?? 'N/A'} ${result.top[0]?.amplitude}%`
    )
  } catch (err) {
    console.error(
      `[cron] ✗ Binance volatility sync failed:`,
      (err as Error).message
    )
  }
}
