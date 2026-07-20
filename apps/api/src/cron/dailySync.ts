import ccxt from 'ccxt'
import {config} from '../config.js'
import {getCandidates, calculateSqueeze} from '../services/paFilter.js'
import {runOperatorEngine} from '../services/operatorEngine.js'

interface Candle {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * 每天 UTC 00:05 执行的完整流水线:
 * 1. PA 过滤 → 候选标的
 * 2. 技术指标计算 → Squeeze 判断
 * 3. 点位算子 → 落 DB + Redis
 */
export async function runDailyWatchlistSync(
  date?: string
): Promise<{date: string; count: number}> {
  const start = Date.now()
  const targetDate = date ?? new Date().toISOString().slice(0, 10)
  console.log(`[watchlist] Starting sync for ${targetDate}`)

  try {
    // 1. PA 过滤
    const candidates = await getCandidates()
    console.log(`[watchlist] Got ${candidates.length} candidates`)

    // 2. 预拉取所有候选标的 15m K 线（用于 VWAP 计算）
    const exchange = new ccxt.binance({
      enableRateLimit: true,
      timeout: 30000,
      options: {defaultType: 'future'}
    })
    if (config.HTTPS_PROXY) {
      await exchange.loadProxyModules()
      exchange.httpsProxy = config.HTTPS_PROXY
    }

    const ohlcvMap = new Map<string, Candle[]>()
    const batchSize = 10
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize)
      await Promise.all(
        batch.map(async c => {
          try {
            const id = c.symbol.split(':')[0].replace('/', '')
            const raw = await exchange.fetchOHLCV(id, '15m', undefined, 96)
            if (raw && raw.length > 0) {
              ohlcvMap.set(
                c.symbol,
                raw.map(k => ({
                  open: k[1] ?? 0,
                  high: k[2] ?? 0,
                  low: k[3] ?? 0,
                  close: k[4] ?? 0,
                  volume: k[5] ?? 0
                }))
              )
            }
          } catch {
            // skip
          }
        })
      )
    }

    // 3. Squeeze 判断
    const squeezed = await calculateSqueeze(candidates)
    console.log(
      `[watchlist] Squeeze analysis: ${squeezed.filter(s => s.isSqueeze).length} squeezing`
    )

    // 4. 点位算子引擎
    const results = await runOperatorEngine(squeezed, ohlcvMap, targetDate)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log(
      `[watchlist] ✓ Complete in ${elapsed}s. Top: ${results
        .slice(0, 3)
        .map(r => `${r.base}(${r.amplitude}%${r.isSqueeze ? ' 🔒' : ''})`)
        .join(', ')}`
    )

    return {date: targetDate, count: results.length}
  } catch (err) {
    console.error('[watchlist] ✗ Sync failed:', (err as Error).message)
    throw err
  }
}
