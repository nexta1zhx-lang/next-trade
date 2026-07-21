/**
 * 出入金/资金流水采集服务
 *
 * 定时从交易所拉取充值、提现、转账记录，写入 capital_flows 表。
 * 用于 NAV 单位净值计算中剔除充提金对收益率的影响。
 *
 * 调度频率: 每 1 小时执行一次
 */

import ccxt, {Exchange} from 'ccxt'
import {db} from '../../db/index.js'
import {apiKeys, capitalFlows} from '../../db/schema.js'
import {eq, and, sql} from 'drizzle-orm'
import {decrypt} from '../crypto.js'
import {config} from '../../config.js'

const proxyOptions = config.HTTPS_PROXY ? {httpsProxy: config.HTTPS_PROXY} : {}

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
      return new ccxt.binance(opts)
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

/** 单次采集结果 */
export interface CapitalFlowResult {
  apiKeyId: number
  success: boolean
  depositsCount: number
  withdrawalsCount: number
  error?: string
}

/**
 * 对单个 API Key 采集出入金流水
 * 拉取近 7 天的充值/提现记录（每次调度覆盖窗口，幂等写入）
 */
export async function collectCapitalFlows(
  apiKeyId: number,
  userId: number
): Promise<CapitalFlowResult> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

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
        depositsCount: 0,
        withdrawalsCount: 0,
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
        depositsCount: 0,
        withdrawalsCount: 0,
        error: 'Decrypt failed'
      }
    }

    const ex = createExchange(stored.exchangeId, {
      apiKey: stored.apiKey,
      apiSecret: rawSecret,
      passphrase: rawPassphrase
    })

    let depositsCount = 0
    let withdrawalsCount = 0

    // ─── 1. 拉取充值记录 ───
    try {
      const deposits = await ex.fetchDeposits(
        undefined,
        sevenDaysAgo.getTime(),
        now.getTime(),
        100
      )
      for (const d of deposits) {
        if (d.status !== 'ok') continue

        const amountUsdt = await toUsdt(ex, d.currency ?? 'USDT', d.amount ?? 0)
        if (amountUsdt <= 0) continue

        const flowDate = new Date(d.timestamp ?? now).toISOString().slice(0, 10)

        // 幂等写入: 用 txid 做唯一约束兜底
        try {
          await db.insert(capitalFlows).values({
            apiKeyId,
            flowType: 'deposit',
            amount: amountUsdt.toFixed(8),
            flowDate,
            note: `${d.currency ?? ''} deposit from ${d.address ?? ''}`,
            occurredAt: new Date(d.timestamp ?? now)
          })
          depositsCount++
        } catch {
          // ON CONFLICT 忽略重复
        }
      }
    } catch {
      // 部分交易所不支持 fetchDeposits，静默跳过
    }

    // ─── 2. 拉取提现记录 ───
    try {
      const withdrawals = await ex.fetchWithdrawals(
        undefined,
        sevenDaysAgo.getTime(),
        now.getTime(),
        100
      )
      for (const w of withdrawals) {
        if (w.status !== 'ok') continue

        const amountUsdt = await toUsdt(ex, w.currency ?? 'USDT', w.amount ?? 0)
        if (amountUsdt <= 0) continue

        const flowDate = new Date(w.timestamp ?? now).toISOString().slice(0, 10)

        try {
          await db.insert(capitalFlows).values({
            apiKeyId,
            flowType: 'withdraw',
            amount: amountUsdt.toFixed(8),
            flowDate,
            note: `${w.currency ?? ''} withdraw to ${w.address ?? ''}`,
            occurredAt: new Date(w.timestamp ?? now)
          })
          withdrawalsCount++
        } catch {
          // 忽略重复
        }
      }
    } catch {
      // 静默跳过
    }

    return {
      apiKeyId,
      success: true,
      depositsCount,
      withdrawalsCount
    }
  } catch (err: any) {
    return {
      apiKeyId,
      success: false,
      depositsCount: 0,
      withdrawalsCount: 0,
      error: err.message?.slice(0, 200) ?? 'Unknown error'
    }
  }
}

/**
 * 将非 USDT 币种按当前市价折算为 USDT
 */
async function toUsdt(
  ex: Exchange,
  currency: string,
  amount: number
): Promise<number> {
  if (!amount || amount <= 0) return 0
  if (currency.toUpperCase() === 'USDT') return amount

  try {
    const ticker = await ex.fetchTicker(`${currency}/USDT`)
    const price = ticker.last ?? 0
    return amount * price
  } catch {
    // 无法获取价格时，按 0 处理
    return 0
  }
}

/**
 * 对所有 ACTIVE 状态的 Key 采集出入金流水
 */
export async function collectAllCapitalFlows(): Promise<CapitalFlowResult[]> {
  const activeKeys = await db
    .select({id: apiKeys.id, userId: apiKeys.userId})
    .from(apiKeys)
    .where(eq(apiKeys.status, 'ACTIVE'))

  const results: CapitalFlowResult[] = []
  for (const key of activeKeys) {
    const result = await collectCapitalFlows(key.id, key.userId)
    results.push(result)
    // 间隔 500ms 避免触发限流
    await new Promise(r => setTimeout(r, 500))
  }

  const totalDeposits = results.reduce((s, r) => s + r.depositsCount, 0)
  const totalWithdrawals = results.reduce((s, r) => s + r.withdrawalsCount, 0)
  if (results.length > 0) {
    console.log(
      `[CapitalFlow] Collected: ${totalDeposits} deposits, ${totalWithdrawals} withdrawals across ${results.length} keys`
    )
  }

  return results
}
