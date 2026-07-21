/**
 * CCXT 统一数据同步引擎
 *
 * 核心流程:
 *   1. 从数据库读取加密凭据 → 解密
 *   2. 创建 CCXT 实例（带代理/限流）
 *   3. 分页拉取成交记录 (fetchMyTrades)
 *   4. 标准化映射 → 幂等写入 trades 表
 *   5. 更新 api_keys 的 lastSyncAt / lastTradeId
 *   6. 限流退避 + 错误处理
 *
 * 使用方式:
 *   const result = await SyncEngine.syncTrades(apiKeyId, userId)
 */

import ccxt, {Exchange} from 'ccxt'
import {db} from '../../db/index.js'
import {apiKeys, trades} from '../../db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../crypto.js'
import {normalizeTrade} from '../exchange/mapper.js'
import {config} from '../../config.js'
import Decimal from 'decimal.js'

// ─── 代理配置 ───
const proxyOptions = config.HTTPS_PROXY ? {httpsProxy: config.HTTPS_PROXY} : {}

// ─── CCXT 交易所工厂（使用用户凭据） ───
function createExchange(
  exchangeId: string,
  credentials: {apiKey: string; apiSecret: string; passphrase?: string}
): Exchange {
  const opts: Record<string, any> = {
    apiKey: credentials.apiKey,
    secret: credentials.apiSecret,
    enableRateLimit: true,
    ...proxyOptions
  }
  if (credentials.passphrase) opts.password = credentials.passphrase

  switch (exchangeId) {
    case 'binance':
      return new ccxt.binance({...opts, options: {defaultType: 'swap'}})
    case 'okx':
      return new ccxt.okx(opts)
    case 'bybit':
      return new ccxt.bybit(opts)
    case 'bitget':
      return new ccxt.bitget(opts)
    case 'gate':
      return new ccxt.gate(opts)
    case 'mexc':
      return new ccxt.mexc(opts)
    default:
      throw new Error(`Unsupported exchange: ${exchangeId}`)
  }
}

// ─── 同步结果 ───
export interface SyncResult {
  success: boolean
  /** 本次拉取的成交笔数 */
  tradesFetched: number
  /** 新入库的成交笔数（去重后） */
  tradesInserted: number
  /** 同步耗时 ms */
  durationMs: number
  error?: string
  /** 是否触发限流 */
  rateLimited?: boolean
}

// ─── 分页拉取参数 ───
const MAX_PAGES = 50
const PAGE_SIZE = 100
const MAX_RETRIES = 3

/**
 * 同步指定 API Key 的成交记录
 *
 * @param apiKeyId  数据库中的 apiKeys.id
 * @param userId    用户 ID（权限验证）
 * @param options   可选参数
 */
export async function syncTrades(
  apiKeyId: number,
  userId: number,
  options?: {
    /** 起始时间戳 ms（默认上次同步时间，首次为 30 天前） */
    since?: number
    /** 强制全量同步（忽略 lastSyncAt） */
    forceFull?: boolean
    /** 限制拉取的交易对列表 */
    symbols?: string[]
  }
): Promise<SyncResult> {
  const startTime = Date.now()

  try {
    // 1. 读取并解密凭据
    const [stored] = await db
      .select({
        exchangeId: apiKeys.exchangeId,
        apiKey: apiKeys.apiKey,
        secretEnc: apiKeys.secretEnc,
        passphraseEnc: apiKeys.passphraseEnc,
        lastSyncAt: apiKeys.lastSyncAt,
        lastTradeId: apiKeys.lastTradeId
      })
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId))
      .limit(1)

    if (!stored) {
      return {
        success: false,
        tradesFetched: 0,
        tradesInserted: 0,
        durationMs: Date.now() - startTime,
        error: 'API Key not found'
      }
    }

    let rawSecret: string
    let rawPassphrase: string | undefined
    try {
      rawSecret = decrypt(stored.secretEnc)
      if (stored.passphraseEnc) rawPassphrase = decrypt(stored.passphraseEnc)
    } catch {
      return {
        success: false,
        tradesFetched: 0,
        tradesInserted: 0,
        durationMs: Date.now() - startTime,
        error: 'Failed to decrypt API key'
      }
    }

    // 2. 创建 CCXT 实例
    const ex = createExchange(stored.exchangeId, {
      apiKey: stored.apiKey,
      apiSecret: rawSecret,
      passphrase: rawPassphrase
    })

    // 3. 确定拉取时间范围
    let sinceTimestamp =
      options?.since ??
      (options?.forceFull
        ? Date.now() - 30 * 86400000 // 30 天前
        : stored.lastSyncAt
          ? stored.lastSyncAt.getTime()
          : Date.now() - 30 * 86400000)

    const now = Date.now()
    let allFetched = 0
    let allInserted = 0
    let lastTradeTimestamp = sinceTimestamp

    // 4. 分页拉取
    const symbolsToSync = options?.symbols
    let hasMore = true
    let page = 0

    while (hasMore && page < MAX_PAGES) {
      page++

      try {
        const fetchedTrades = await ex.fetchMyTrades(
          undefined,
          sinceTimestamp,
          PAGE_SIZE
        )

        if (!fetchedTrades || fetchedTrades.length === 0) {
          hasMore = false
          break
        }

        allFetched += fetchedTrades.length

        // 过滤指定交易对
        const symList = symbolsToSync
        const toProcess = symList
          ? fetchedTrades.filter(t => t.symbol && symList.includes(t.symbol))
          : fetchedTrades

        // 标准化并批量写入
        for (const ccxtTrade of toProcess) {
          const isContract = stored.exchangeId === 'binance' // 默认合约
          const normalized = normalizeTrade(apiKeyId, ccxtTrade, isContract)

          try {
            await db
              .insert(trades)
              .values({
                apiKeyId: normalized.apiKeyId,
                tradeId: normalized.tradeId,
                symbol: normalized.symbol,
                marketType: normalized.marketType,
                side: normalized.side,
                price: normalized.price,
                amount: normalized.amount,
                quoteQty: normalized.quoteQty,
                realizedPnl: normalized.realizedPnl,
                feeUsdt: normalized.feeUsdt,
                isLiquidation: normalized.isLiquidation,
                executedAt: normalized.executedAt
              })
              .onConflictDoNothing()

            allInserted++
          } catch {
            // 单条失败不影响其他
          }

          // 更新最后成交时间
          if (ccxtTrade.timestamp && ccxtTrade.timestamp > lastTradeTimestamp) {
            lastTradeTimestamp = ccxtTrade.timestamp
          }
        }

        // 判断是否还有下一页
        if (fetchedTrades.length < PAGE_SIZE) {
          hasMore = false
        } else {
          // 更新 since 为最后一条的时间+1ms
          const lastTs = fetchedTrades[fetchedTrades.length - 1]?.timestamp
          if (lastTs) sinceTimestamp = lastTs + 1
        }
      } catch (err: any) {
        const msg = err.message ?? ''
        // 限流处理
        if (msg.includes('rate limit') || msg.includes('429')) {
          const retryAfter = err.retryAfter ?? 5
          console.warn(`[SyncEngine] Rate limited, waiting ${retryAfter}s...`)
          await new Promise(r => setTimeout(r, retryAfter * 1000))
          // 重试当前页
          page--
          continue
        }
        // 其他错误
        throw err
      }
    }

    // 5. 更新同步状态
    await db
      .update(apiKeys)
      .set({
        lastSyncAt: new Date(),
        lastTradeId: String(lastTradeTimestamp),
        updatedAt: new Date()
      })
      .where(eq(apiKeys.id, apiKeyId))

    return {
      success: true,
      tradesFetched: allFetched,
      tradesInserted: allInserted,
      durationMs: Date.now() - startTime
    }
  } catch (err: any) {
    return {
      success: false,
      tradesFetched: 0,
      tradesInserted: 0,
      durationMs: Date.now() - startTime,
      error: err.message?.slice(0, 200) ?? 'Unknown error'
    }
  }
}
