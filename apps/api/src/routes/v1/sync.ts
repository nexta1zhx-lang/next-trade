/**
 * V1 数据同步路由
 *
 * POST   /api/v1/sync/reconstruct          — 对所有 Key 执行历史逆向推演
 * POST   /api/v1/sync/reconstruct/:id      — 对指定 Key 执行历史逆向推演
 * GET    /api/v1/sync/status               — 同步状态查询
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {db} from '../../db/index.js'
import {apiKeys} from '../../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {reconstructHistoricalEquity} from '../../services/sync/historicalReconstruction.js'
import ccxt from 'ccxt'
import {decrypt} from '../../services/crypto.js'
import {config} from '../../config.js'

const router = new Hono()

// ─── 所有接口需要登录 ───
router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

// ═══════════════════════════════════════════
// POST /api/v1/sync/reconstruct — 所有 Key 历史重建
// ═══════════════════════════════════════════
const reconstructSchema = z.object({
  days: z.coerce.number().min(1).max(180).default(90)
})

router.post('/reconstruct', zValidator('json', reconstructSchema), async c => {
  const userId = (c as any).get('userId') as number
  const {days} = c.req.valid('json')

  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.status, 'ACTIVE')))

  if (keys.length === 0) {
    return c.json({success: false, error: 'No active keys found'}, 404)
  }

  // 异步执行所有 Key 的重建
  c.executionCtx.waitUntil(
    (async () => {
      for (const key of keys) {
        await reconstructHistoricalEquity(key.id, userId, days)
      }
    })()
  )

  return c.json({
    success: true,
    data: {
      message: `历史资金曲线重建已启动，${keys.length} 个 Key，追溯 ${days} 天`,
      keys: keys.map(k => k.id)
    }
  })
})

// ═══════════════════════════════════════════
// POST /api/v1/sync/reconstruct/:id — 指定 Key
// ═══════════════════════════════════════════
router.post(
  '/reconstruct/:id',
  zValidator('json', reconstructSchema),
  async c => {
    const userId = (c as any).get('userId') as number
    const id = parseInt(c.req.param('id'))
    const {days} = c.req.valid('json')

    const [key] = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .limit(1)

    if (!key) return c.json({success: false, error: 'Key not found'}, 404)

    // 异步执行
    c.executionCtx.waitUntil(reconstructHistoricalEquity(id, userId, days))

    return c.json({
      success: true,
      data: {
        message: `Key ${id} 历史资金曲线重建已启动，追溯 ${days} 天`
      }
    })
  }
)

// ═══════════════════════════════════════════
// GET /api/v1/sync/debug-balance/:id — 调试: 查看币安返回的原始 balance
// ═══════════════════════════════════════════
router.get('/debug-balance/:id', async c => {
  const userId = (c as any).get('userId') as number
  const id = parseInt(c.req.param('id'))

  const [stored] = await db
    .select({
      exchangeId: apiKeys.exchangeId,
      apiKey: apiKeys.apiKey,
      secretEnc: apiKeys.secretEnc,
      passphraseEnc: apiKeys.passphraseEnc
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .limit(1)

  if (!stored) return c.json({success: false, error: 'Key not found'}, 404)

  let rawSecret: string
  try {
    rawSecret = decrypt(stored.secretEnc)
  } catch {
    return c.json({success: false, error: 'Decrypt failed'}, 500)
  }

  const proxyOptions = config.HTTPS_PROXY
    ? {httpsProxy: config.HTTPS_PROXY}
    : {}
  const ex = new ccxt.binance({
    apiKey: stored.apiKey,
    secret: rawSecret,
    enableRateLimit: true,
    options: {defaultType: 'swap'},
    ...proxyOptions
  })

  try {
    // 加载代理模块
    if (config.HTTPS_PROXY) {
      await ex.loadProxyModules()
      ex.httpsProxy = config.HTTPS_PROXY
    }

    const balance = await ex.fetchBalance()

    // 提取关键结构用于调试
    const summary: Record<string, any> = {}
    for (const [coin, acct] of Object.entries(balance)) {
      if (
        coin === 'info' ||
        coin === 'free' ||
        coin === 'used' ||
        coin === 'total'
      )
        continue
      summary[coin] = acct
    }

    return c.json({
      success: true,
      data: {
        topLevelKeys: Object.keys(balance).filter(k => !['info'].includes(k)),
        usdtEntry: balance['USDT'] ?? balance['usdt'] ?? null,
        summary,
        balanceTotal: (balance as any).total,
        balanceFree: (balance as any).free,
        balanceUsed: (balance as any).used,
        // 用 snapshotService 相同的逻辑算一次
        totalUsdtCalc: calculateDebugTotal(balance)
      }
    })
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: err.message?.slice(0, 500)
      },
      502
    )
  }
})

function calculateDebugTotal(balance: any): number {
  let total = 0
  const skip = new Set([
    'info',
    'free',
    'used',
    'total',
    'datetime',
    'timestamp'
  ])
  for (const [coin, acct] of Object.entries(balance)) {
    if (skip.has(coin)) continue
    if (!acct || typeof acct !== 'object') continue
    const bal = acct as Record<string, any>
    const b = typeof bal.total === 'number' ? bal.total : Number(bal.total ?? 0)
    if (b > 0 && coin.toUpperCase() === 'USDT') total += b
  }
  return total
}

// ═══════════════════════════════════════════
// GET /api/v1/sync/status — 同步状态查询
// ═══════════════════════════════════════════
router.get('/status', async c => {
  return c.json({
    success: true,
    data: {
      queueSize: 0,
      activeJobs: 0,
      completedToday: 0,
      failedToday: 0
    }
  })
})

export {router as v1SyncRouter}
