/**
 * 权益 REST 采集器
 *
 * 职责:
 *   1. 拉取 U本位合约账户 (GET /fapi/v2/account)
 *   2. 拉取资金钱包 USDT (GET /sapi/v1/asset/wallet)
 *   3. 发布 EQUITY_RECONCILE 事件
 *
 * 复用 tradeSyncService.ts 的 signedGet 签名机制
 */

import crypto from 'node:crypto'
import {db} from '../db/index.js'
import {apiKeys} from '../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {decrypt} from './crypto.js'
import {publishEquityReconcile} from '../streams/eventStream.js'

const FAPI_BASE = 'https://fapi.binance.com'
const SAPI_BASE = 'https://api.binance.com'

// ─── 工具函数 ───

function sign(secret: string, qs: string): string {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex')
}

async function signedGet(
  apiKey: string,
  secret: string,
  baseUrl: string,
  path: string,
  params: Record<string, unknown> = {}
): Promise<any> {
  const qsParts = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qsParts.set(k, String(v))
  qsParts.set('recvWindow', '60000')
  qsParts.set('timestamp', String(Date.now()))
  const qs = qsParts.toString()
  const signature = sign(secret, qs)

  const res = await fetch(`${baseUrl}${path}?${qs}&signature=${signature}`, {
    headers: {'X-MBX-APIKEY': apiKey}
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function getKeyCredentials(
  apiKeyId: number
): Promise<{apiKey: string; secret: string}> {
  const [key] = await db
    .select({
      apiKey: apiKeys.apiKey,
      secretEnc: apiKeys.secretEnc
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error(`API Key not found: ${apiKeyId}`)
  return {apiKey: key.apiKey, secret: decrypt(key.secretEnc)}
}

// ─── REST 拉取 ───

interface CollectResult {
  apiKeyId: number
  futuresWallet: number
  unrealizedPnl: number
  fundingUsdt: number
}

/**
 * 拉取单个 Key 的完整权益
 * 权重: /fapi/v2/account = 5, /sapi/v1/asset/wallet = 10
 */
export async function collectEquity(apiKeyId: number): Promise<CollectResult> {
  const {apiKey, secret} = await getKeyCredentials(apiKeyId)

  // 并行拉取合约账户 + 资金钱包
  const [futuresData, walletData] = await Promise.all([
    signedGet(apiKey, secret, FAPI_BASE, '/fapi/v2/account'),
    signedGet(apiKey, secret, SAPI_BASE, '/sapi/v1/asset/wallet').catch(
      (err: Error) => {
        console.warn(
          `[equityCollector] 资金钱包拉取失败 key=${apiKeyId}:`,
          err.message
        )
        return [] // 资金钱包失败时返回空数组，不阻塞
      }
    )
  ])

  const futuresWallet = parseFloat(futuresData.totalWalletBalance ?? '0')
  const unrealizedPnl = parseFloat(futuresData.totalUnrealizedProfit ?? '0')

  // 从资金钱包中提取 USDT
  const walletArr: Array<{asset: string; free: string; locked: string}> =
    Array.isArray(walletData) ? walletData : []
  const usdtEntry = walletArr.find(w => w.asset === 'USDT')
  const fundingUsdt = usdtEntry
    ? parseFloat(usdtEntry.free) + parseFloat(usdtEntry.locked)
    : 0

  return {apiKeyId, futuresWallet, unrealizedPnl, fundingUsdt}
}

/**
 * 采集单个 Key 并发布校准事件
 */
export async function collectAndPublish(apiKeyId: number): Promise<void> {
  try {
    const result = await collectEquity(apiKeyId)
    await publishEquityReconcile({
      type: 'EQUITY_RECONCILE',
      apiKeyId: result.apiKeyId,
      futuresWallet: String(result.futuresWallet),
      unrealizedPnl: String(result.unrealizedPnl),
      fundingUsdt: String(result.fundingUsdt)
    })
    console.log(
      `[equityCollector] 采集完成 key=${apiKeyId} ` +
        `fWallet=${result.futuresWallet.toFixed(2)} ` +
        `upnl=${result.unrealizedPnl.toFixed(2)} ` +
        `fund=${result.fundingUsdt.toFixed(2)}`
    )
  } catch (err) {
    console.error(
      `[equityCollector] 采集失败 key=${apiKeyId}:`,
      (err as Error).message
    )
  }
}

/** 全局运行锁，防止 Cron 重叠 */
let collectRunning = false

/**
 * 对所有 ACTIVE Key 执行采集（定时 Cron 调用）
 */
export async function collectAllKeys(): Promise<void> {
  if (collectRunning) {
    console.warn('[equityCollector] 采集已在运行，跳过本次触发')
    return
  }
  collectRunning = true
  try {
    const keys = await db
      .select({id: apiKeys.id})
      .from(apiKeys)
      .where(
        and(eq(apiKeys.exchangeId, 'binance'), eq(apiKeys.status, 'ACTIVE'))
      )

    // 串行采集，避免触发权重限制
    for (const key of keys) {
      await collectAndPublish(key.id)
      // 每个 Key 间隔 200ms，平滑 API 权重
      await new Promise(r => setTimeout(r, 200))
    }

    console.log(`[equityCollector] 全量采集完成: ${keys.length} keys`)
  } finally {
    collectRunning = false
  }
}
