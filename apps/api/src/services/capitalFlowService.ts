/**
 * 出入金流水服务
 *
 * 通过 Wallet SDK 拉取充提记录，写入 capital_flows 表，
 * 用于在 ROI/收益计算中剔除出入金干扰。
 */

import {ConfigurationRestAPI} from '@binance/common'
import {WalletRestAPI} from '@binance/wallet'
import {HttpsProxyAgent} from 'https-proxy-agent'
import {db} from '../db/index.js'
import {capitalFlows, apiKeys} from '../db/schema.js'
import {eq, and, sql} from 'drizzle-orm'
import {decrypt} from './crypto.js'
import {config} from '../config.js'

function createWalletSDK(apiKey: string, secret: string) {
  const cfg = new ConfigurationRestAPI({apiKey, apiSecret: secret})
  if (config.HTTPS_PROXY) {
    ;(cfg as any).baseOptions.httpsAgent = new HttpsProxyAgent(
      config.HTTPS_PROXY
    )
  }
  return new WalletRestAPI.RestAPI(cfg)
}

// ─── 拉取充值记录 ───

async function fetchDeposits(
  apiKey: string,
  secret: string
): Promise<Array<{amount: number; time: number; txId: string}>> {
  const sdk = createWalletSDK(apiKey, secret)
  const res = await sdk.depositHistory({limit: 100})
  const data: Array<Record<string, any>> = Array.isArray(res.data)
    ? res.data
    : []

  return data
    .filter(d => Number(d.status) === 1) // 仅已成功的
    .map(d => ({
      amount: Number(d.amount),
      time: Number(d.insertTime),
      txId: d.txId
    }))
}

// ─── 拉取提现记录 ───

async function fetchWithdrawals(
  apiKey: string,
  secret: string
): Promise<Array<{amount: number; time: number; txId: string}>> {
  const sdk = createWalletSDK(apiKey, secret)
  const res = await sdk.withdrawHistory({limit: 100})
  const data: Array<Record<string, any>> = Array.isArray(res.data)
    ? res.data
    : []

  return data
    .filter(w => Number(w.status) === 6) // 仅已完成的
    .map(w => ({
      amount: Number(w.amount),
      time: w.completeTime ? Number(w.completeTime) : Date.parse(w.applyTime),
      txId: w.txId || w.id
    }))
}

// ─── 主同步函数 ───

/**
 * 拉取某 Key 的充提记录并写入 capital_flows 表
 */
export async function syncCapitalFlows(apiKeyId: number): Promise<{
  deposits: number
  withdrawals: number
}> {
  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)

  if (!keyRecord) throw new Error(`API Key ${apiKeyId} not found`)

  const rawSecret = decrypt(keyRecord.secretEnc)

  const [deposits, withdrawals] = await Promise.all([
    fetchDeposits(keyRecord.apiKey, rawSecret),
    fetchWithdrawals(keyRecord.apiKey, rawSecret)
  ])

  let dCount = 0
  let wCount = 0

  // 写入充值
  for (const d of deposits) {
    try {
      // 非 USDT 按 1:1 近似折算（精确折算需要价格，简化处理）
      await db
        .insert(capitalFlows)
        .values({
          apiKeyId,
          flowType: 'deposit',
          amount: String(d.amount),
          flowDate: new Date(d.time).toISOString().slice(0, 10),
          note: `deposit ${d.txId}`,
          occurredAt: new Date(d.time)
        })
        .onConflictDoNothing({
          target: [
            capitalFlows.apiKeyId,
            capitalFlows.occurredAt,
            capitalFlows.flowType
          ]
        })
      dCount++
    } catch (err) {
      // 重复记录忽略
    }
  }

  // 写入提现
  for (const w of withdrawals) {
    try {
      await db
        .insert(capitalFlows)
        .values({
          apiKeyId,
          flowType: 'withdraw',
          amount: String(w.amount),
          flowDate: new Date(w.time).toISOString().slice(0, 10),
          note: `withdraw ${w.txId}`,
          occurredAt: new Date(w.time)
        })
        .onConflictDoNothing({
          target: [
            capitalFlows.apiKeyId,
            capitalFlows.occurredAt,
            capitalFlows.flowType
          ]
        })
      wCount++
    } catch (err) {
      // 重复记录忽略
    }
  }

  console.log(
    `[CapitalFlow] key=${apiKeyId} 同步完成: ${dCount} 笔充值, ${wCount} 笔提现`
  )

  return {deposits: dCount, withdrawals: wCount}
}

// ─── 查询 ───

/**
 * 获取某 Key 自起始日期以来的净入金（入金 - 出金）
 * 正值表示净入金，负值表示净出金
 */
export async function getNetDeposits(
  apiKeyId: number,
  sinceDate: string
): Promise<number> {
  const rows = await db
    .select({
      flowType: capitalFlows.flowType,
      amount: capitalFlows.amount
    })
    .from(capitalFlows)
    .where(
      and(
        eq(capitalFlows.apiKeyId, apiKeyId),
        sql`${capitalFlows.flowDate} >= ${sinceDate}`
      )
    )

  let net = 0
  for (const r of rows) {
    if (r.flowType === 'deposit') net += Number(r.amount)
    else if (r.flowType === 'withdraw') net -= Number(r.amount)
  }
  return net
}
