/**
 * 资产采集服务
 *
 * 从 Binance 多模块拉取余额并汇总为 USDT 本位总权益
 * 支持的模块：现货、资金钱包、U本位合约、理财(活期/定期)、全仓杠杆
 *
 * 参考: Binance.md — 资产统计 API 接口清单
 */

import {createHmac} from 'node:crypto'
import {db} from '../db/index.js'
import {assetSnapshots, apiKeys} from '../db/schema.js'
import {eq, and, desc, sql} from 'drizzle-orm'
import {config} from '../config.js'
import {decrypt} from './crypto.js'
import {redis} from './redis.js'

// ─── 类型 ───

interface BalanceEntry {
  asset: string
  free: string
  locked: string
  /** 折算后的 USDT 价值 */
  usdtValue: number
}

interface ModuleBalance {
  name: string
  entries: BalanceEntry[]
  totalUsdt: number
}

interface AssetDetail {
  spot: BalanceEntry[]
  funding: BalanceEntry[]
  futures: {
    walletBalance: string
    unrealizedPnl: string
    positions: Array<{
      symbol: string
      positionAmt: string
      entryPrice: string
      markPrice: string
      unrealizedProfit: string
    }>
  }
  earn: BalanceEntry[]
  margin: {
    totalCollateralValueInUSDT: string
    totalNetAsset: string
    totalDebt: string
    entries: BalanceEntry[]
  }
  prices: Record<string, string>
}

interface CollectResult {
  apiKeyId: number
  snapDate: string
  totalEquity: number
  spotValue: number
  contractEquity: number
  unrealizedPnl: number
  fundingValue: number
  earnValue: number
  marginEquity: number
  marginDebt: number
  details: AssetDetail
}

// ─── Binance API 签名 ───

const BASE_API = 'https://api.binance.com'
const BASE_FAPI = 'https://fapi.binance.com'
const BASE_SAPI = 'https://api.binance.com'

function signQuery(queryString: string, secret: string): string {
  return createHmac('sha256', secret).update(queryString).digest('hex')
}

async function signedRequest<T>(
  apiKey: string,
  secret: string,
  method: 'GET' | 'POST',
  baseUrl: string,
  path: string,
  body?: Record<string, string>
): Promise<T> {
  const timestamp = Date.now()
  let queryString = `timestamp=${timestamp}`
  if (body) {
    const params = new URLSearchParams(body).toString()
    queryString = `${params}&timestamp=${timestamp}`
  }
  const signature = signQuery(queryString, secret)
  const url = `${baseUrl}${path}?${queryString}&signature=${signature}`

  const res = await fetch(url, {
    method,
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Binance API ${method} ${path} ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

// ─── 各模块余额拉取 ───

/** ① 现货钱包 GET /api/v3/account */
async function fetchSpotBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const data = await signedRequest<{
    balances: Array<{asset: string; free: string; locked: string}>
  }>(apiKey, secret, 'GET', BASE_API, '/api/v3/account')
  return data.balances
    .filter(b => Number(b.free) > 0 || Number(b.locked) > 0)
    .map(b => ({
      asset: b.asset,
      free: b.free,
      locked: b.locked,
      usdtValue: 0 // 稍后折算
    }))
}

/** ② 资金钱包 POST /sapi/v1/asset/get-funding-asset */
async function fetchFundingBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const data = await signedRequest<
    Array<{asset: string; free: string; locked: string}>
  >(apiKey, secret, 'POST', BASE_SAPI, '/sapi/v1/asset/get-funding-asset', {
    asset: 'ALL'
  })
  return data.map(b => ({
    asset: b.asset,
    free: b.free,
    locked: b.locked,
    usdtValue: 0
  }))
}

/** ③ U本位合约 GET /fapi/v2/account */
async function fetchUSDTFutureBalance(
  apiKey: string,
  secret: string
): Promise<{
  walletBalance: string
  unrealizedPnl: string
  positions: AssetDetail['futures']['positions']
}> {
  const data = await signedRequest<{
    totalWalletBalance: string
    totalUnrealizedProfit: string
    assets: Array<{
      asset: string
      walletBalance: string
      unrealizedProfit: string
    }>
    positions: Array<{
      symbol: string
      positionAmt: string
      entryPrice: string
      markPrice: string
      unrealizedProfit: string
    }>
  }>(apiKey, secret, 'GET', BASE_FAPI, '/fapi/v2/account')

  return {
    walletBalance: data.totalWalletBalance,
    unrealizedPnl: data.totalUnrealizedProfit,
    positions: data.positions.filter(p => Number(p.positionAmt) !== 0)
  }
}

/** ④ 活期理财 GET /sapi/v1/simple-earn/flexible/position */
async function fetchEarnFlexibleBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const data = await signedRequest<{
    rows?: Array<{asset: string; totalAmount: string} | Record<string, unknown>>
  }>(
    apiKey,
    secret,
    'GET',
    BASE_SAPI,
    '/sapi/v1/simple-earn/flexible/position',
    {
      size: '100'
    }
  )
  if (!data.rows) return []
  return data.rows.map((r: any) => ({
    asset: r.asset ?? r.loanAsset ?? 'UNKNOWN',
    free: r.totalAmount ?? r.amount ?? '0',
    locked: '0',
    usdtValue: 0
  }))
}

/** ⑤ 定期理财 GET /sapi/v1/simple-earn/locked/position */
async function fetchEarnLockedBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const data = await signedRequest<{
    rows?: Array<{asset: string; totalAmount: string} | Record<string, unknown>>
  }>(apiKey, secret, 'GET', BASE_SAPI, '/sapi/v1/simple-earn/locked/position', {
    size: '100'
  })
  if (!data.rows) return []
  return data.rows.map((r: any) => ({
    asset: r.asset ?? r.loanAsset ?? 'UNKNOWN',
    free: r.totalAmount ?? r.amount ?? '0',
    locked: '0',
    usdtValue: 0
  }))
}

/** ⑥ 全仓杠杆 GET /sapi/v1/margin/account */
async function fetchMarginBalance(
  apiKey: string,
  secret: string
): Promise<AssetDetail['margin']> {
  const data = await signedRequest<{
    totalCollateralValueInUSDT: string
    totalNetAssetOfBorrow: string
    totalNetAsset: string
    totalDebt: string
    userAssets: Array<{
      asset: string
      free: string
      locked: string
      borrowed: string
      netAsset: string
    }>
  }>(apiKey, secret, 'GET', BASE_SAPI, '/sapi/v1/margin/account')

  return {
    totalCollateralValueInUSDT: data.totalCollateralValueInUSDT,
    totalNetAsset: data.totalNetAsset ?? data.totalNetAssetOfBorrow,
    totalDebt: data.totalDebt,
    entries: data.userAssets
      .filter(a => Number(a.netAsset) > 0.0001)
      .map(a => ({
        asset: a.asset,
        free: a.netAsset,
        locked: '0',
        usdtValue: 0
      }))
  }
}

/** ⑦ 实时价格 GET /api/v3/ticker/price（无需认证） */
async function fetchPrices(): Promise<Record<string, string>> {
  const url = `${BASE_API}/api/v3/ticker/price`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Price API ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as Array<{symbol: string; price: string}>
  const map: Record<string, string> = {}
  for (const item of data) {
    map[item.symbol] = item.price
  }
  return map
}

/** 获取 USDT 标记价（合约不直接用现货价计算未实现盈亏） */
async function fetchMarkPrices(): Promise<Record<string, string>> {
  const url = `${BASE_FAPI}/fapi/v1/premiumIndex`
  const res = await fetch(url)
  if (!res.ok)
    throw new Error(`MarkPrice API ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as Array<{symbol: string; markPrice: string}>
  const map: Record<string, string> = {}
  for (const item of data) {
    map[item.symbol] = item.markPrice
  }
  return map
}

// ─── USDT 折算 ───

/**
 * 将非 USDT 余额折算为 USDT 价值
 * @param entries 各币种余额
 * @param prices 现货价格表 { BTCUSDT: "67000", ... }
 * @param markPrices 合约标记价表
 */
function convertToUsdt(
  entries: BalanceEntry[],
  prices: Record<string, string>,
  markPrices: Record<string, string>
): number {
  let total = 0
  for (const entry of entries) {
    const asset = entry.asset
    if (
      asset === 'USDT' ||
      asset === 'BUSD' ||
      asset === 'FDUSD' ||
      asset === 'USDC'
    ) {
      // 稳定币按 1:1
      entry.usdtValue = Number(entry.free) + Number(entry.locked)
    } else {
      // 找现货价格对
      const pair = `${asset}USDT`
      const price = prices[pair]
      if (price && Number(price) > 0) {
        entry.usdtValue =
          (Number(entry.free) + Number(entry.locked)) * Number(price)
      }
    }
    total += entry.usdtValue
  }
  return total
}

// ─── 主采集函数 ───

/**
 * 对单个 API Key 执行一次完整的资产快照采集
 */
export async function collectAssetSnapshot(
  apiKeyId: number
): Promise<CollectResult> {
  // 1. 从 DB 获取 key 信息
  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)

  if (!keyRecord) throw new Error(`API Key ${apiKeyId} not found`)
  if (keyRecord.status !== 'ACTIVE')
    throw new Error(`API Key ${apiKeyId} is ${keyRecord.status}`)

  const rawApiKey = keyRecord.apiKey
  const rawSecret = decrypt(keyRecord.secretEnc)

  const today = new Date()
  const snapDate = today.toISOString().slice(0, 10)

  // 2. 并行拉取实时价格
  const [prices, markPrices] = await Promise.all([
    fetchPrices(),
    fetchMarkPrices()
  ])

  // 3. 并行拉取各模块余额
  const [
    spotRaw,
    fundingRaw,
    futuresData,
    earnFlexRaw,
    earnLockedRaw,
    marginData
  ] = await Promise.all([
    fetchSpotBalance(rawApiKey, rawSecret),
    fetchFundingBalance(rawApiKey, rawSecret),
    fetchUSDTFutureBalance(rawApiKey, rawSecret),
    fetchEarnFlexibleBalance(rawApiKey, rawSecret),
    fetchEarnLockedBalance(rawApiKey, rawSecret),
    fetchMarginBalance(rawApiKey, rawSecret)
  ])

  // 4. USDT 折算
  const spotValue = convertToUsdt(spotRaw, prices, markPrices)
  const fundingValue = convertToUsdt(fundingRaw, prices, markPrices)
  const earnValue =
    convertToUsdt(earnFlexRaw, prices, markPrices) +
    convertToUsdt(earnLockedRaw, prices, markPrices)

  // 合约权益 = 钱包余额 + 未实现盈亏（已含全部持仓的未实现盈亏）
  const contractEquity =
    Number(futuresData.walletBalance) + Number(futuresData.unrealizedPnl)
  const unrealizedPnl = Number(futuresData.unrealizedPnl)

  // 杠杆用 netAsset（已扣除债务）
  const marginEquity = Number(marginData.totalNetAsset)
  const marginDebt = Number(marginData.totalDebt)

  // 5. 计算总权益
  const totalEquity =
    spotValue + fundingValue + contractEquity + earnValue + marginEquity

  // 6. 构建明细
  const details: AssetDetail = {
    spot: spotRaw,
    funding: fundingRaw,
    futures: futuresData,
    earn: [...earnFlexRaw, ...earnLockedRaw],
    margin: marginData,
    prices
  }

  // 7. 写入 DB
  const snapshotAt = new Date()
  await db
    .insert(assetSnapshots)
    .values({
      apiKeyId,
      snapDate,
      totalEquity: String(totalEquity),
      spotValue: String(spotValue),
      contractEquity: String(contractEquity),
      unrealizedPnl: String(unrealizedPnl),
      fundingValue: String(fundingValue),
      earnValue: String(earnValue),
      marginEquity: String(marginEquity),
      marginDebt: String(marginDebt),
      details,
      snapshotAt
    })
    .onConflictDoUpdate({
      target: [assetSnapshots.apiKeyId, assetSnapshots.snapDate],
      set: {
        totalEquity: String(totalEquity),
        spotValue: String(spotValue),
        contractEquity: String(contractEquity),
        unrealizedPnl: String(unrealizedPnl),
        fundingValue: String(fundingValue),
        earnValue: String(earnValue),
        marginEquity: String(marginEquity),
        marginDebt: String(marginDebt),
        details,
        snapshotAt
      }
    })

  console.log(
    `[AssetSnapshot] key=${apiKeyId} date=${snapDate} total=${totalEquity.toFixed(2)} ` +
      `spot=${spotValue.toFixed(2)} funding=${fundingValue.toFixed(2)} ` +
      `contract=${contractEquity.toFixed(2)} earn=${earnValue.toFixed(2)} ` +
      `margin=${marginEquity.toFixed(2)}`
  )

  // 8. 清除 Redis 缓存
  if (redis.status === 'ready') {
    const keys = await redis.keys(`asset:snapshots:${apiKeyId}:*`)
    if (keys.length > 0) await redis.del(keys)
  }

  return {
    apiKeyId,
    snapDate,
    totalEquity,
    spotValue,
    contractEquity,
    unrealizedPnl,
    fundingValue,
    earnValue,
    marginEquity,
    marginDebt,
    details
  }
}

/**
 * 采集某个用户所有 ACTIVE 的 Binance Key
 */
export async function collectAllUserKeys(
  userId: number
): Promise<CollectResult[]> {
  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.exchangeId, 'binance'),
        eq(apiKeys.status, 'ACTIVE')
      )
    )

  const results: CollectResult[] = []
  for (const key of keys) {
    try {
      const result = await collectAssetSnapshot(key.id)
      results.push(result)
    } catch (err) {
      console.error(
        `[AssetSnapshot] key=${key.id} 采集失败:`,
        (err as Error).message
      )
    }
  }
  return results
}

/**
 * 采集所有用户的 ACTIVE Binance Key（定时任务使用）
 */
export async function collectAllKeys(): Promise<CollectResult[]> {
  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.exchangeId, 'binance'), eq(apiKeys.status, 'ACTIVE')))

  const results: CollectResult[] = []
  for (const key of keys) {
    try {
      const result = await collectAssetSnapshot(key.id)
      results.push(result)
    } catch (err) {
      console.error(
        `[AssetSnapshot] key=${key.id} 采集失败:`,
        (err as Error).message
      )
    }
  }
  return results
}

// ─── 查询接口 ───

export interface SnapshotRow {
  snapDate: string
  totalEquity: string
  spotValue: string | null
  contractEquity: string | null
  unrealizedPnl: string | null
  fundingValue: string | null
  earnValue: string | null
  marginEquity: string | null
  marginDebt: string | null
}

/**
 * 获取某 Key 最近 N 天的资产快照
 */
export async function getSnapshots(
  apiKeyId: number,
  days = 30
): Promise<SnapshotRow[]> {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const rows = await db
    .select({
      snapDate: assetSnapshots.snapDate,
      totalEquity: assetSnapshots.totalEquity,
      spotValue: assetSnapshots.spotValue,
      contractEquity: assetSnapshots.contractEquity,
      unrealizedPnl: assetSnapshots.unrealizedPnl,
      fundingValue: assetSnapshots.fundingValue,
      earnValue: assetSnapshots.earnValue,
      marginEquity: assetSnapshots.marginEquity,
      marginDebt: assetSnapshots.marginDebt
    })
    .from(assetSnapshots)
    .where(
      and(
        eq(assetSnapshots.apiKeyId, apiKeyId),
        sql`${assetSnapshots.snapDate} >= ${cutoffStr}`
      )
    )
    .orderBy(desc(assetSnapshots.snapDate))

  return rows
}

/**
 * 获取某 Key 最新的快照（当前资产概览）
 */
export async function getLatestSnapshot(
  apiKeyId: number
): Promise<CollectResult | null> {
  const row = await db
    .select()
    .from(assetSnapshots)
    .where(eq(assetSnapshots.apiKeyId, apiKeyId))
    .orderBy(desc(assetSnapshots.snapDate))
    .limit(1)

  if (row.length === 0) return null

  const r = row[0]
  return {
    apiKeyId: r.apiKeyId,
    snapDate: r.snapDate,
    totalEquity: Number(r.totalEquity),
    spotValue: Number(r.spotValue),
    contractEquity: Number(r.contractEquity),
    unrealizedPnl: Number(r.unrealizedPnl),
    fundingValue: Number(r.fundingValue),
    earnValue: Number(r.earnValue),
    marginEquity: Number(r.marginEquity),
    marginDebt: Number(r.marginDebt),
    details: (r.details ?? {}) as AssetDetail
  }
}
