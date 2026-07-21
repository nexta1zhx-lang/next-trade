/**
 * 全量资产快照服务
 *
 * 定时采集各交易所全部资产并折算为 USDT 总净值:
 *   1. 现货账户 — 遍历所有币种，按当前市场价折算 USDT
 *   2. 合约账户 (USDT-M) — 含未实现盈亏
 *   3. 币本位合约/交割 (COIN-M) — 按当前价折算
 *
 * 数据存入 account_snapshots 表，用于 NAV 资金曲线计算。
 */

import ccxt, {Exchange} from 'ccxt'
import {db} from '../../db/index.js'
import {apiKeys, accountSnapshots} from '../../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {decrypt} from '../crypto.js'
import {config} from '../../config.js'
import Decimal from 'decimal.js'

const proxyOptions = config.HTTPS_PROXY ? {httpsProxy: config.HTTPS_PROXY} : {}

function createExchange(
  exchangeId: string,
  marketType: 'spot' | 'swap' | 'future',
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
      return new ccxt.binance({...opts, options: {defaultType: marketType}})
    case 'okx':
      return new ccxt.okx({...opts, options: {defaultType: marketType}})
    case 'bybit':
      return new ccxt.bybit({...opts, options: {defaultType: marketType}})
    case 'bitget':
      return new ccxt.bitget({...opts, options: {defaultType: marketType}})
    case 'gate':
      return new ccxt.gate({...opts, options: {defaultType: marketType}})
    case 'mexc':
      return new ccxt.mexc({...opts, options: {defaultType: marketType}})
    default:
      throw new Error(`Unsupported exchange: ${exchangeId}`)
  }
}

/** 单次快照结果 */
export interface SnapshotResult {
  apiKeyId: number
  success: boolean
  totalNetValue: string
  spotBalance: string
  contractEquity: string
  unrealizedPnl: string
  marginUsed: string
  notionalValue: string
  error?: string
}

/**
 * 对单个 API Key 执行余额快照
 */
export async function takeSnapshot(
  apiKeyId: number,
  userId: number
): Promise<SnapshotResult> {
  const zero = '0'
  const now = new Date()

  try {
    const [stored] = await db
      .select({
        exchangeId: apiKeys.exchangeId,
        apiKey: apiKeys.apiKey,
        secretEnc: apiKeys.secretEnc,
        passphraseEnc: apiKeys.passphraseEnc
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
      .limit(1)

    if (!stored) {
      return {
        apiKeyId,
        success: false,
        totalNetValue: zero,
        spotBalance: zero,
        contractEquity: zero,
        unrealizedPnl: zero,
        marginUsed: zero,
        notionalValue: zero,
        error: 'Key not found'
      }
    }

    let rawSecret: string
    let rawPassphrase: string | undefined
    try {
      rawSecret = decrypt(stored.secretEnc)
      if (stored.passphraseEnc) rawPassphrase = decrypt(stored.passphraseEnc)
    } catch {
      return {
        apiKeyId,
        success: false,
        totalNetValue: zero,
        spotBalance: zero,
        contractEquity: zero,
        unrealizedPnl: zero,
        marginUsed: zero,
        notionalValue: zero,
        error: 'Decrypt failed'
      }
    }

    const ex = createExchange(stored.exchangeId, 'swap', {
      apiKey: stored.apiKey,
      apiSecret: rawSecret,
      passphrase: rawPassphrase
    })

    // ═══════════════════════════════════════════
    // 获取全量资产并折算为 USDT 总净值
    //   总权益 = 现货折算 USDT + 合约权益 USDT
    // ═══════════════════════════════════════════
    let totalUsdt = new Decimal(0)

    // 1) 现货账户：Σ(持仓数量 × 当前价格)
    try {
      const spotEx = createExchange(stored.exchangeId, 'spot', {
        apiKey: stored.apiKey,
        apiSecret: rawSecret,
        passphrase: rawPassphrase
      })
      const spotBal = await spotEx.fetchBalance()
      const spotTotal = (spotBal as any).total ?? {}
      for (const [coin, amount] of Object.entries(spotTotal)) {
        const amt = Number(amount) || 0
        if (amt <= 0) continue
        if (coin.toUpperCase() === 'USDT') {
          totalUsdt = totalUsdt.add(amt)
        } else {
          try {
            const ticker = await spotEx.fetchTicker(`${coin}/USDT`)
            const price = ticker.last ?? 0
            if (price > 0) totalUsdt = totalUsdt.add(amt * price)
          } catch {
            /* 无法获取价格跳过 */
          }
        }
      }
    } catch {} // 现货失败不影响

    // 2) 合约权益 (USDT-M swap): 钱包余额 + 未实现盈亏
    try {
      const swapBal = await ex.fetchBalance()
      const swapTotal = (swapBal as any).total ?? {}
      // 先从 total 取 USDT 余额（CCXT 通常已包含未实现盈亏）
      let swapEquity = Number(swapTotal['USDT']) || 0
      // 再尝试从 info 读取未实现盈亏补充
      const info = (swapBal as any).info
      if (info?.assets) {
        for (const asset of info.assets) {
          if (asset.asset === 'USDT') {
            const upnl = Number(asset.unrealizedProfit) || 0
            const walletBal = Number(asset.walletBalance) || 0
            // 如果 swapTotal.USDT 不可靠，用 walletBalance + unrealizedProfit
            if (swapEquity === 0 && (walletBal > 0 || upnl !== 0)) {
              swapEquity = walletBal + upnl
            }
            break
          }
        }
      }
      if (swapEquity > 0) totalUsdt = totalUsdt.add(swapEquity)
    } catch (swapErr: any) {
      if (!swapErr.message?.includes('capital/config')) {
        console.warn(
          `[snapshot] swap balance failed for key ${apiKeyId}:`,
          swapErr.message?.slice(0, 100)
        )
      }
    }

    // 3) 币本位合约 (COIN-M): 按当前价折算 USDT
    try {
      const coinmEx = createExchange(stored.exchangeId, 'future', {
        apiKey: stored.apiKey,
        apiSecret: rawSecret,
        passphrase: rawPassphrase
      })
      const coinmBal = await coinmEx.fetchBalance()
      const coinmTotal = (coinmBal as any).total ?? {}
      for (const [coin, amount] of Object.entries(coinmTotal)) {
        const amt = Number(amount) || 0
        if (amt <= 0) continue
        if (coin.toUpperCase() === 'USDT') {
          totalUsdt = totalUsdt.add(amt)
        } else {
          try {
            const ticker = await ex.fetchTicker(`${coin}/USDT`)
            const price = ticker.last ?? 0
            if (price > 0) totalUsdt = totalUsdt.add(amt * price)
          } catch {}
        }
      }
    } catch {} // 币本位失败不影响

    // 写入快照
    await db.insert(accountSnapshots).values({
      apiKeyId,
      totalNetValue: totalUsdt.toFixed(8),
      spotBalance: totalUsdt.toFixed(8),
      contractEquity: '0',
      unrealizedPnl: '0',
      marginUsed: '0',
      notionalValue: '0',
      snapshotAt: now
    })

    return {
      apiKeyId,
      success: true,
      totalNetValue: totalUsdt.toFixed(2),
      spotBalance: totalUsdt.toFixed(2),
      contractEquity: '0.00',
      unrealizedPnl: '0.00',
      marginUsed: '0.00',
      notionalValue: '0.00'
    }
  } catch (err: any) {
    return {
      apiKeyId,
      success: false,
      totalNetValue: zero,
      spotBalance: zero,
      contractEquity: zero,
      unrealizedPnl: zero,
      marginUsed: zero,
      notionalValue: zero,
      error: err.message?.slice(0, 200) ?? 'Unknown error'
    }
  }
}

/**
 * 对所有 ACTIVE 状态的 Key 执行快照
 */
export async function takeAllSnapshots(): Promise<SnapshotResult[]> {
  const activeKeys = await db
    .select({id: apiKeys.id, userId: apiKeys.userId})
    .from(apiKeys)
    .where(eq(apiKeys.status, 'ACTIVE'))

  const results: SnapshotResult[] = []
  for (const key of activeKeys) {
    const result = await takeSnapshot(key.id, key.userId)
    results.push(result)
    // 间隔 200ms 避免触发限流
    await new Promise(r => setTimeout(r, 200))
  }
  return results
}
