/**
 * 资产采集服务 — Binance SDK 版
 *
 * 使用官方 Binance SDK 替代手写 HMAC 签名，
 * 从多模块拉取余额并汇总为 USDT 本位总净资产。
 *
 * 总净资产 = Funding(资金) + Spot(现货) + Futures_U(U本位) + Futures_Coin(币本位) + Earn(理财)
 */

import {
  ConfigurationRestAPI,
  SPOT_REST_API_PROD_URL,
  WALLET_REST_API_PROD_URL,
  SIMPLE_EARN_REST_API_PROD_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL,
  DERIVATIVES_TRADING_COIN_FUTURES_REST_API_PROD_URL
} from '@binance/common'
import {SpotRestAPI} from '@binance/spot'
import {WalletRestAPI} from '@binance/wallet'
import {SimpleEarnRestAPI} from '@binance/simple-earn'
import {DerivativesTradingUsdsFuturesRestAPI} from '@binance/derivatives-trading-usds-futures'
import {DerivativesTradingCoinFuturesRestAPI} from '@binance/derivatives-trading-coin-futures'

import {db} from '../db/index.js'
import {accountSnapshots, dailySummaries, apiKeys} from '../db/schema.js'
import {eq, and, desc, sql} from 'drizzle-orm'
import {decrypt} from './crypto.js'
import {redis} from './redis.js'

// ─── 类型 ───

export interface BalanceEntry {
  asset: string
  free: string
  locked: string
  usdtValue: number
}

export interface SnapshotDetail {
  spot: BalanceEntry[]
  funding: BalanceEntry[]
  futuresU: {walletBalance: string; unrealizedPnl: string}
  futuresCoin: {walletBalance: string; unrealizedPnl: string}
  earn: BalanceEntry[]
  prices: Record<string, string>
}

export interface CollectResult {
  apiKeyId: number
  totalNetVal: number
  fundingVal: number
  spotVal: number
  futuresUVal: number
  futuresCoinVal: number
  earnVal: number
  snapshotAt: Date
  details: SnapshotDetail
}

// ─── SDK 工厂 ───

const SDK_TIMEOUT = 15_000 // 15s，Binance API 响应较慢时需放宽超时

function createConfig(basePath: string) {
  return (apiKey: string, secret: string) =>
    new ConfigurationRestAPI({
      apiKey,
      apiSecret: secret,
      basePath,
      timeout: SDK_TIMEOUT
    })
}

const createSpotConfig = createConfig(SPOT_REST_API_PROD_URL)
const createWalletConfig = createConfig(WALLET_REST_API_PROD_URL)
const createEarnConfig = createConfig(SIMPLE_EARN_REST_API_PROD_URL)
const createUsdsFuturesConfig = createConfig(
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL
)
const createCoinFuturesConfig = createConfig(
  DERIVATIVES_TRADING_COIN_FUTURES_REST_API_PROD_URL
)

function createSpotSDK(apiKey: string, secret: string) {
  return new SpotRestAPI.RestAPI(createSpotConfig(apiKey, secret))
}

function createWalletSDK(apiKey: string, secret: string) {
  return new WalletRestAPI.RestAPI(createWalletConfig(apiKey, secret))
}

function createEarnSDK(apiKey: string, secret: string) {
  return new SimpleEarnRestAPI.RestAPI(createEarnConfig(apiKey, secret))
}

function createUsdsFuturesSDK(apiKey: string, secret: string) {
  return new DerivativesTradingUsdsFuturesRestAPI.RestAPI(
    createUsdsFuturesConfig(apiKey, secret)
  )
}

function createCoinFuturesSDK(apiKey: string, secret: string) {
  return new DerivativesTradingCoinFuturesRestAPI.RestAPI(
    createCoinFuturesConfig(apiKey, secret)
  )
}

// ─── 各模块余额拉取 ───

/** ① 现货钱包 */
async function fetchSpotBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const sdk = createSpotSDK(apiKey, secret)
  const res = await sdk.getAccount()
  const balances: Array<{asset: string; free: string; locked: string}> =
    (res.data as any)?.balances ?? []
  return balances
    .filter(b => Number(b.free) > 0 || Number(b.locked) > 0)
    .map(b => ({asset: b.asset, free: b.free, locked: b.locked, usdtValue: 0}))
}

/** ② 资金钱包 */
async function fetchFundingBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const sdk = createWalletSDK(apiKey, secret)
  const res = await sdk.fundingWallet()
  const data: Array<{asset: string; free: string; locked: string}> =
    Array.isArray(res.data) ? res.data : []
  console.log('fundingWallet() response:', data)

  return data.map(b => ({
    asset: b.asset,
    free: b.free,
    locked: b.locked,
    usdtValue: 0
  }))
}

/** ③ U本位合约 */
async function fetchFuturesUBalance(
  apiKey: string,
  secret: string
): Promise<{walletBalance: string; unrealizedPnl: string}> {
  const sdk = createUsdsFuturesSDK(apiKey, secret)
  const res = await sdk.accountInformationV3()
  // 注意: 期货 SDK 的 res.data 是函数，需要 await 调用
  const data =
    typeof (res as any).data === 'function'
      ? await (res as any).data()
      : (res as any).data
  const d = data ?? {}
  return {
    walletBalance: d.totalWalletBalance ?? '0',
    unrealizedPnl: d.totalUnrealizedProfit ?? '0'
  }
}

/** ④ 币本位合约 */
async function fetchFuturesCoinBalance(
  apiKey: string,
  secret: string
): Promise<{walletBalance: string; unrealizedPnl: string}> {
  const sdk = createCoinFuturesSDK(apiKey, secret)
  const res = await sdk.accountInformation()
  // 注意: 期货 SDK 的 res.data 是函数，需要 await 调用
  const data =
    typeof (res as any).data === 'function'
      ? await (res as any).data()
      : (res as any).data
  const d = data ?? {}
  // 币本位合约没有顶层 totalWalletBalance，需从 assets 汇总
  const assets: Array<{
    asset: string
    walletBalance: string
    unrealizedProfit: string
  }> = d.assets ?? []
  let totalWallet = 0
  let totalUpnl = 0
  for (const a of assets) {
    totalWallet += Number(a.walletBalance ?? 0)
    totalUpnl += Number(a.unrealizedProfit ?? 0)
  }
  return {
    walletBalance: d.totalWalletBalance ?? String(totalWallet),
    unrealizedPnl: d.totalUnrealizedProfit ?? String(totalUpnl)
  }
}

/** ⑤ 活期理财 */
async function fetchEarnFlexibleBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const sdk = createEarnSDK(apiKey, secret)
  const res = await sdk.getFlexibleProductPosition({})
  const rows: Array<Record<string, any>> = (res.data as any)?.rows ?? []
  return rows.map(r => ({
    asset: r.asset ?? 'UNKNOWN',
    free: r.totalAmount ?? r.amount ?? '0',
    locked: '0',
    usdtValue: 0
  }))
}

/** ⑥ 定期理财 */
async function fetchEarnLockedBalance(
  apiKey: string,
  secret: string
): Promise<BalanceEntry[]> {
  const sdk = createEarnSDK(apiKey, secret)
  const res = await sdk.getLockedProductPosition({})
  const rows: Array<Record<string, any>> = (res.data as any)?.rows ?? []
  return rows.map(r => ({
    asset: r.asset ?? 'UNKNOWN',
    free: r.totalAmount ?? r.amount ?? '0',
    locked: '0',
    usdtValue: 0
  }))
}

/** ⑦ 实时价格（无需认证，直接 fetch） */
async function fetchPrices(): Promise<Record<string, string>> {
  const url = 'https://api.binance.com/api/v3/ticker/price'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Price API ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as Array<{symbol: string; price: string}>
  const map: Record<string, string> = {}
  for (const item of data) map[item.symbol] = item.price
  return map
}

// ─── USDT 折算 ───

function convertToUsdt(
  entries: BalanceEntry[],
  prices: Record<string, string>
): number {
  let total = 0
  for (const entry of entries) {
    const asset = entry.asset
    if (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(asset)) {
      entry.usdtValue = Number(entry.free) + Number(entry.locked)
    } else {
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

export async function collectAssetSnapshot(
  apiKeyId: number
): Promise<CollectResult> {
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
  const snapshotAt = new Date()

  // 并行拉取实时价格
  let prices: Record<string, string> = {}
  try {
    prices = await fetchPrices()
    console.log(
      `[AssetSnapshot] key=${apiKeyId} 获取价格成功, ${Object.keys(prices).length} 个币种`
    )
  } catch (err) {
    console.error(
      `[AssetSnapshot] key=${apiKeyId} 获取价格失败:`,
      (err as Error).message
    )
  }

  // 并行拉取各模块余额
  const [
    spotRaw,
    fundingRaw,
    futuresUData,
    futuresCoinData,
    earnFlexRaw,
    earnLockedRaw
  ] = await Promise.allSettled([
    fetchSpotBalance(rawApiKey, rawSecret),
    fetchFundingBalance(rawApiKey, rawSecret),
    fetchFuturesUBalance(rawApiKey, rawSecret),
    fetchFuturesCoinBalance(rawApiKey, rawSecret),
    fetchEarnFlexibleBalance(rawApiKey, rawSecret),
    fetchEarnLockedBalance(rawApiKey, rawSecret)
  ])

  // 记录各模块采集状态
  const moduleResults = [
    {name: 'spot', status: spotRaw.status, err: spotRaw},
    {name: 'funding', status: fundingRaw.status, err: fundingRaw},
    {name: 'futuresU', status: futuresUData.status, err: futuresUData},
    {name: 'futuresCoin', status: futuresCoinData.status, err: futuresCoinData},
    {name: 'earnFlex', status: earnFlexRaw.status, err: earnFlexRaw},
    {name: 'earnLocked', status: earnLockedRaw.status, err: earnLockedRaw}
  ]
  for (const m of moduleResults) {
    if (m.status === 'rejected') {
      console.error(
        `[AssetSnapshot] key=${apiKeyId} ${m.name} 采集失败:`,
        (m.err as any).reason?.message
      )
    }
  }

  // USDT 折算（带错误兜底）
  const spotVal =
    spotRaw.status === 'fulfilled' ? convertToUsdt(spotRaw.value, prices) : 0
  const fundingVal =
    fundingRaw.status === 'fulfilled'
      ? convertToUsdt(fundingRaw.value, prices)
      : 0
  const futuresUVal =
    futuresUData.status === 'fulfilled'
      ? Number(futuresUData.value.walletBalance ?? 0) +
        Number(futuresUData.value.unrealizedPnl ?? 0)
      : 0
  const futuresCoinVal =
    futuresCoinData.status === 'fulfilled'
      ? Number(futuresCoinData.value.walletBalance ?? 0) +
        Number(futuresCoinData.value.unrealizedPnl ?? 0)
      : 0
  const earnVal =
    (earnFlexRaw.status === 'fulfilled'
      ? convertToUsdt(earnFlexRaw.value, prices)
      : 0) +
    (earnLockedRaw.status === 'fulfilled'
      ? convertToUsdt(earnLockedRaw.value, prices)
      : 0)

  const totalNetVal =
    fundingVal + spotVal + futuresUVal + futuresCoinVal + earnVal

  const details: SnapshotDetail = {
    spot: spotRaw.status === 'fulfilled' ? spotRaw.value : [],
    funding: fundingRaw.status === 'fulfilled' ? fundingRaw.value : [],
    futuresU:
      futuresUData.status === 'fulfilled'
        ? futuresUData.value
        : {walletBalance: '0', unrealizedPnl: '0'},
    futuresCoin:
      futuresCoinData.status === 'fulfilled'
        ? futuresCoinData.value
        : {walletBalance: '0', unrealizedPnl: '0'},
    earn: [
      ...(earnFlexRaw.status === 'fulfilled' ? earnFlexRaw.value : []),
      ...(earnLockedRaw.status === 'fulfilled' ? earnLockedRaw.value : [])
    ],
    prices
  }

  await db.insert(accountSnapshots).values({
    apiKeyId,
    totalNetVal: String(totalNetVal),
    fundingVal: String(fundingVal),
    spotVal: String(spotVal),
    futuresUVal: String(futuresUVal),
    futuresCoinVal: String(futuresCoinVal),
    earnVal: String(earnVal),
    details,
    snapshotAt
  })

  console.log(
    `[AssetSnapshot] key=${apiKeyId} total=${totalNetVal.toFixed(2)} ` +
      `fund=${fundingVal.toFixed(2)} spot=${spotVal.toFixed(2)} ` +
      `fU=${futuresUVal.toFixed(2)} fCoin=${futuresCoinVal.toFixed(2)} earn=${earnVal.toFixed(2)}`
  )

  await updateRedisCache(apiKeyId, {
    totalNetVal,
    fundingVal,
    spotVal,
    futuresUVal,
    futuresCoinVal,
    earnVal,
    snapshotAt: snapshotAt.toISOString()
  })

  // 更新 lastSyncAt，让前端显示正确的同步时间
  await db
    .update(apiKeys)
    .set({lastSyncAt: snapshotAt, updatedAt: snapshotAt})
    .where(eq(apiKeys.id, apiKeyId))

  return {
    apiKeyId,
    totalNetVal,
    fundingVal,
    spotVal,
    futuresUVal,
    futuresCoinVal,
    earnVal,
    snapshotAt,
    details
  }
}

// ─── Redis 缓存 ───

interface RedisAssetCache {
  totalNetVal: number
  fundingVal: number
  spotVal: number
  futuresUVal: number
  futuresCoinVal: number
  earnVal: number
  snapshotAt: string
}

async function updateRedisCache(
  apiKeyId: number,
  data: RedisAssetCache
): Promise<void> {
  if (redis.status !== 'ready') return
  const userId = await getUserIdByKeyId(apiKeyId)
  if (!userId) return
  const key = `asset:current:${userId}`
  const existing = await redis.get(key)
  const map: Record<string, RedisAssetCache> = existing
    ? JSON.parse(existing)
    : {}
  map[String(apiKeyId)] = data
  await redis.set(key, JSON.stringify(map), 'EX', 3600)
}

async function getUserIdByKeyId(apiKeyId: number): Promise<number | null> {
  const [row] = await db
    .select({userId: apiKeys.userId})
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  return row?.userId ?? null
}

// ─── 以下查询/聚合函数不变 ───

export interface SnapshotRow {
  snapshotAt: Date
  totalNetVal: string
  fundingVal: string | null
  spotVal: string | null
  futuresUVal: string | null
  futuresCoinVal: string | null
  earnVal: string | null
}

export async function getSnapshots(
  apiKeyId: number,
  since: string
): Promise<SnapshotRow[]> {
  return db
    .select({
      snapshotAt: accountSnapshots.snapshotAt,
      totalNetVal: accountSnapshots.totalNetVal,
      fundingVal: accountSnapshots.fundingVal,
      spotVal: accountSnapshots.spotVal,
      futuresUVal: accountSnapshots.futuresUVal,
      futuresCoinVal: accountSnapshots.futuresCoinVal,
      earnVal: accountSnapshots.earnVal
    })
    .from(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.apiKeyId, apiKeyId),
        sql`${accountSnapshots.snapshotAt} >= ${since}::timestamp`
      )
    )
    .orderBy(accountSnapshots.snapshotAt)
}

export async function getLatestSnapshot(
  apiKeyId: number
): Promise<CollectResult | null> {
  const [row] = await db
    .select()
    .from(accountSnapshots)
    .where(eq(accountSnapshots.apiKeyId, apiKeyId))
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(1)
  if (!row) return null
  return {
    apiKeyId: row.apiKeyId,
    totalNetVal: Number(row.totalNetVal),
    fundingVal: Number(row.fundingVal),
    spotVal: Number(row.spotVal),
    futuresUVal: Number(row.futuresUVal),
    futuresCoinVal: Number(row.futuresCoinVal),
    earnVal: Number(row.earnVal),
    snapshotAt: row.snapshotAt,
    details: (row.details ?? {}) as SnapshotDetail
  }
}

export async function getTodayExtremes(apiKeyId: number): Promise<{
  highVal: number
  highTime: Date | null
  lowVal: number
  lowTime: Date | null
} | null> {
  const [earliest] = await db
    .select({sa: accountSnapshots.snapshotAt})
    .from(accountSnapshots)
    .where(eq(accountSnapshots.apiKeyId, apiKeyId))
    .orderBy(accountSnapshots.snapshotAt)
    .limit(1)
  const since = earliest
    ? new Date(
        Math.max(earliest.sa.getTime(), Date.now() - 24 * 60 * 60 * 1000)
      ).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const rows = await db
    .select({
      totalNetVal: accountSnapshots.totalNetVal,
      snapshotAt: accountSnapshots.snapshotAt
    })
    .from(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.apiKeyId, apiKeyId),
        sql`${accountSnapshots.snapshotAt} >= ${since}::timestamp`
      )
    )
    .orderBy(accountSnapshots.snapshotAt)
  if (rows.length === 0) return null
  let highVal = Number(rows[0].totalNetVal),
    highTime = rows[0].snapshotAt
  let lowVal = Number(rows[0].totalNetVal),
    lowTime = rows[0].snapshotAt
  for (const r of rows) {
    const v = Number(r.totalNetVal)
    if (v > highVal) {
      highVal = v
      highTime = r.snapshotAt
    }
    if (v < lowVal) {
      lowVal = v
      lowTime = r.snapshotAt
    }
  }
  return {highVal, highTime, lowVal, lowTime}
}

export async function getTodayIntraday(
  apiKeyId: number
): Promise<Array<{time: string; value: number}>> {
  const [earliest] = await db
    .select({sa: accountSnapshots.snapshotAt})
    .from(accountSnapshots)
    .where(eq(accountSnapshots.apiKeyId, apiKeyId))
    .orderBy(accountSnapshots.snapshotAt)
    .limit(1)
  const since = earliest
    ? new Date(
        Math.max(earliest.sa.getTime(), Date.now() - 24 * 60 * 60 * 1000)
      ).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const rows = await db
    .select({
      totalNetVal: accountSnapshots.totalNetVal,
      snapshotAt: accountSnapshots.snapshotAt
    })
    .from(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.apiKeyId, apiKeyId),
        sql`${accountSnapshots.snapshotAt} >= ${since}::timestamp`
      )
    )
    .orderBy(accountSnapshots.snapshotAt)
  return rows.map(r => ({
    time: r.snapshotAt.toISOString(),
    value: Number(r.totalNetVal)
  }))
}

export async function aggregateDailySummary(
  apiKeyId: number,
  dateStr: string
): Promise<void> {
  const dayStart = dateStr + 'T00:00:00Z'
  const dayEnd = dateStr + 'T23:59:59.999Z'
  const rows = await db
    .select({
      totalNetVal: accountSnapshots.totalNetVal,
      snapshotAt: accountSnapshots.snapshotAt
    })
    .from(accountSnapshots)
    .where(
      and(
        eq(accountSnapshots.apiKeyId, apiKeyId),
        sql`${accountSnapshots.snapshotAt} >= ${dayStart}::timestamp`,
        sql`${accountSnapshots.snapshotAt} <= ${dayEnd}::timestamp`
      )
    )
    .orderBy(accountSnapshots.snapshotAt)
  if (rows.length === 0) return
  const openVal = Number(rows[0].totalNetVal),
    closeVal = Number(rows[rows.length - 1].totalNetVal)
  let highVal = openVal,
    highTime = rows[0].snapshotAt,
    lowVal = openVal,
    lowTime = rows[0].snapshotAt
  for (const r of rows) {
    const v = Number(r.totalNetVal)
    if (v > highVal) {
      highVal = v
      highTime = r.snapshotAt
    }
    if (v < lowVal) {
      lowVal = v
      lowTime = r.snapshotAt
    }
  }
  const amplitude = lowVal > 0 ? ((highVal - lowVal) / lowVal) * 100 : 0
  await db
    .insert(dailySummaries)
    .values({
      apiKeyId,
      date: dateStr,
      openVal: String(openVal),
      highVal: String(highVal),
      highTime,
      lowVal: String(lowVal),
      lowTime,
      closeVal: String(closeVal),
      amplitude: String(amplitude.toFixed(4))
    })
    .onConflictDoUpdate({
      target: [dailySummaries.apiKeyId, dailySummaries.date],
      set: {
        openVal: String(openVal),
        highVal: String(highVal),
        highTime,
        lowVal: String(lowVal),
        lowTime,
        closeVal: String(closeVal),
        amplitude: String(amplitude.toFixed(4))
      }
    })
  console.log(
    `[DailySummary] key=${apiKeyId} date=${dateStr} O=${openVal.toFixed(2)} H=${highVal.toFixed(2)} L=${lowVal.toFixed(2)} C=${closeVal.toFixed(2)}`
  )
}

export async function getDailyOHLC(
  apiKeyId: number,
  days = 90
): Promise<
  Array<{
    date: string
    openVal: number
    highVal: number
    lowVal: number
    closeVal: number
    amplitude: number
    highTime: string | null
    lowTime: string | null
  }>
> {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const rows = await db
    .select()
    .from(dailySummaries)
    .where(
      and(
        eq(dailySummaries.apiKeyId, apiKeyId),
        sql`${dailySummaries.date} >= ${cutoff.toISOString().slice(0, 10)}`
      )
    )
    .orderBy(dailySummaries.date)
  return rows.map(r => ({
    date: r.date,
    openVal: Number(r.openVal),
    highVal: Number(r.highVal),
    lowVal: Number(r.lowVal),
    closeVal: Number(r.closeVal),
    amplitude: Number(r.amplitude),
    highTime: r.highTime?.toISOString() ?? null,
    lowTime: r.lowTime?.toISOString() ?? null
  }))
}

export async function getCachedCurrentAssets(
  userId: number
): Promise<Record<string, RedisAssetCache> | null> {
  if (redis.status !== 'ready') return null
  const raw = await redis.get(`asset:current:${userId}`)
  return raw ? JSON.parse(raw) : null
}
