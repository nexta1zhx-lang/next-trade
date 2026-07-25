/**
 * 资产采集测试脚本（不入库）
 *
 * 运行完整的采集流程，打印币安原始返回和汇总结果。
 *
 * 使用方式:
 *   cd apps/api && npx tsx scripts/test-collect.ts
 *
 * 如需指定 API Key ID:
 *   npx tsx scripts/test-collect.ts --key-id=2
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
import {db} from '../src/db/index.js'
import {apiKeys} from '../src/db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../src/services/crypto.js'

// ─── 解析参数 ───
const keyId = Number(
  process.argv.find(a => a.startsWith('--key-id='))?.split('=')[1] ?? 2
)

// ─── SDK 工具（与 assetService.ts 一致） ───
const SDK_TIMEOUT = 15_000 // 15s

function createConfig(basePath: string) {
  return (apiKey: string, secret: string) =>
    new ConfigurationRestAPI({
      apiKey,
      apiSecret: secret,
      basePath,
      timeout: SDK_TIMEOUT
    })
}

const spotCfg = createConfig(SPOT_REST_API_PROD_URL)
const walletCfg = createConfig(WALLET_REST_API_PROD_URL)
const earnCfg = createConfig(SIMPLE_EARN_REST_API_PROD_URL)
const futuresUCfg = createConfig(
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL
)
const futuresCoinCfg = createConfig(
  DERIVATIVES_TRADING_COIN_FUTURES_REST_API_PROD_URL
)

function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return `[${v.length} items]`
  if (typeof v === 'object') return JSON.stringify(v, null, 2).slice(0, 3000)
  return String(v)
}

function logDiv(title: string) {
  console.log()
  console.log('═'.repeat(60))
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

function logRes(label: string, raw: unknown, ms: number) {
  const status = raw instanceof Error ? '❌' : '✅'
  console.log(`  ${status} ${label} (${ms}ms)`)
  if (raw instanceof Error) {
    console.log(`     错误: ${raw.message}`)
  } else {
    const str = fmt(raw)
    if (str.length > 200) {
      console.log(`     原始响应 (前 2000 字符):`)
      console.log(`     ${str.slice(0, 2000)}`)
    } else {
      console.log(`     原始响应: ${str}`)
    }
  }
}

// ─── 类型 ───
interface BalanceEntry {
  asset: string
  free: string
  locked: string
  usdtValue: number
}

// ─── 各模块拉取 ───

async function fetchSpotBalance(apiKey: string, secret: string) {
  const sdk = new SpotRestAPI.RestAPI(spotCfg(apiKey, secret))
  const t = Date.now()
  const res = await sdk.getAccount()
  const ms = Date.now() - t
  const balances: Array<{asset: string; free: string; locked: string}> =
    (res.data as any)?.balances ?? []
  const nonZero = balances.filter(
    b => Number(b.free) > 0 || Number(b.locked) > 0
  )
  logRes(
    '现货钱包 (getAccount → balances)',
    {
      totalBalances: balances.length,
      nonZero: nonZero.length,
      sample: nonZero
        .slice(0, 5)
        .map(b => `${b.asset}: free=${b.free} locked=${b.locked}`)
    },
    ms
  )
  return nonZero.map(b => ({
    asset: b.asset,
    free: b.free,
    locked: b.locked,
    usdtValue: 0
  }))
}

async function fetchFundingBalance(apiKey: string, secret: string) {
  const sdk = new WalletRestAPI.RestAPI(walletCfg(apiKey, secret))
  const t = Date.now()
  try {
    const res = await sdk.fundingWallet()
    const ms = Date.now() - t
    const data: Array<{asset: string; free: string; locked: string}> =
      Array.isArray(res.data) ? res.data : []
    logRes(
      '资金钱包 (fundingWallet)',
      {
        count: data.length,
        items: data
          .slice(0, 5)
          .map(b => `${b.asset}: free=${b.free} locked=${b.locked}`)
      },
      ms
    )
    return data.map(b => ({
      asset: b.asset,
      free: b.free,
      locked: b.locked,
      usdtValue: 0
    }))
  } catch (e: any) {
    console.log(`  ❌ 资金钱包 (${Date.now() - t}ms)`)
    console.log(`     message: ${e.message}`)
    if (e.status) console.log(`     status: ${e.status}`)
    if (e.code) console.log(`     code: ${e.code}`)
    if (e.response?.data)
      console.log(
        `     response: ${JSON.stringify(e.response.data).slice(0, 300)}`
      )
    throw e
  }
}

async function fetchFuturesUBalance(apiKey: string, secret: string) {
  const sdk = new DerivativesTradingUsdsFuturesRestAPI.RestAPI(
    futuresUCfg(apiKey, secret)
  )
  const t = Date.now()
  try {
    const res = await sdk.accountInformationV3()
    const ms = Date.now() - t
    console.log(`  ✅ U本位合约 (${ms}ms)`)
    console.log(
      `     🔍 res 顶层 key: ${Object.keys(res as object).join(', ')}`
    )
    console.log(`     🔍 res.data 类型: ${typeof (res as any).data}`)
    const rawData =
      typeof (res as any).data === 'function'
        ? await (res as any).data()
        : (res as any).data
    console.log(`     🔍 rawData 类型: ${typeof rawData}`)
    console.log(`     🔍 rawData key: ${Object.keys(rawData ?? {}).join(', ')}`)
    try {
      console.log(
        `     🔍 完整原始响应:\n${JSON.stringify(rawData, null, 2).slice(0, 3000)}`
      )
    } catch {
      console.log(`     (JSON.stringify 失败)`)
    }
    console.log(`     → totalWalletBalance=${rawData?.totalWalletBalance}`)
    console.log(
      `     → totalUnrealizedProfit=${rawData?.totalUnrealizedProfit}`
    )
    const d = rawData ?? {}
    return {
      walletBalance: String(d.totalWalletBalance ?? '0'),
      unrealizedPnl: String(d.totalUnrealizedProfit ?? '0')
    }
  } catch (e: any) {
    console.log(`  ❌ U本位合约 (${Date.now() - t}ms)`)
    console.log(`     message: ${e.message}`)
    if (e.status) console.log(`     status: ${e.status}`)
    if (e.code) console.log(`     code: ${e.code}`)
    if (e.response?.data)
      console.log(
        `     response: ${JSON.stringify(e.response.data).slice(0, 300)}`
      )
    throw e
  }
}

async function fetchFuturesCoinBalance(apiKey: string, secret: string) {
  const sdk = new DerivativesTradingCoinFuturesRestAPI.RestAPI(
    futuresCoinCfg(apiKey, secret)
  )
  const t = Date.now()
  try {
    const res = await sdk.accountInformation()
    const ms = Date.now() - t
    console.log(`  ✅ 币本位合约 (${ms}ms)`)
    console.log(
      `     🔍 res 顶层 key: ${Object.keys(res as object).join(', ')}`
    )
    console.log(`     🔍 res.data 类型: ${typeof (res as any).data}`)
    const rawData =
      typeof (res as any).data === 'function'
        ? await (res as any).data()
        : (res as any).data
    console.log(`     🔍 rawData 类型: ${typeof rawData}`)
    console.log(`     🔍 rawData key: ${Object.keys(rawData ?? {}).join(', ')}`)
    try {
      console.log(
        `     🔍 完整原始响应:\n${JSON.stringify(rawData, null, 2).slice(0, 3000)}`
      )
    } catch {
      console.log(`     (JSON.stringify 失败)`)
    }
    console.log(`     → totalWalletBalance=${rawData?.totalWalletBalance}`)
    console.log(
      `     → totalUnrealizedProfit=${rawData?.totalUnrealizedProfit}`
    )
    // 币本位合约没有顶层 total* 字段，需从 assets 汇总
    const assets: Array<{
      asset: string
      walletBalance: string
      unrealizedProfit: string
    }> = rawData?.assets ?? []
    let totalWallet = 0,
      totalUpnl = 0
    for (const a of assets) {
      totalWallet += Number(a.walletBalance ?? 0)
      totalUpnl += Number(a.unrealizedProfit ?? 0)
    }
    const d = rawData ?? {}
    return {
      walletBalance: d.totalWalletBalance ?? String(totalWallet),
      unrealizedPnl: d.totalUnrealizedProfit ?? String(totalUpnl)
    }
  } catch (e: any) {
    console.log(`  ❌ 币本位合约 (${Date.now() - t}ms)`)
    console.log(`     message: ${e.message}`)
    if (e.status) console.log(`     status: ${e.status}`)
    if (e.code) console.log(`     code: ${e.code}`)
    if (e.response?.data)
      console.log(
        `     response: ${JSON.stringify(e.response.data).slice(0, 300)}`
      )
    throw e
  }
}

async function fetchEarnFlexibleBalance(apiKey: string, secret: string) {
  const sdk = new SimpleEarnRestAPI.RestAPI(earnCfg(apiKey, secret))
  const t = Date.now()
  try {
    const res = await sdk.getFlexibleProductPosition({})
    const ms = Date.now() - t
    const rows: Array<Record<string, any>> = (res.data as any)?.rows ?? []
    logRes(
      '活期理财 (getFlexibleProductPosition)',
      {
        count: rows.length,
        items: rows
          .slice(0, 5)
          .map(r => `${r.asset}: amount=${r.totalAmount ?? r.amount}`)
      },
      ms
    )
    return rows.map(r => ({
      asset: r.asset ?? 'UNKNOWN',
      free: r.totalAmount ?? r.amount ?? '0',
      locked: '0',
      usdtValue: 0
    }))
  } catch (e: any) {
    console.log(`  ❌ 活期理财 (${Date.now() - t}ms)`)
    console.log(`     message: ${e.message}`)
    if (e.status) console.log(`     status: ${e.status}`)
    if (e.code) console.log(`     code: ${e.code}`)
    if (e.response?.data)
      console.log(
        `     response: ${JSON.stringify(e.response.data).slice(0, 300)}`
      )
    throw e
  }
}

async function fetchEarnLockedBalance(apiKey: string, secret: string) {
  const sdk = new SimpleEarnRestAPI.RestAPI(earnCfg(apiKey, secret))
  const t = Date.now()
  try {
    const res = await sdk.getLockedProductPosition({})
    const ms = Date.now() - t
    const rows: Array<Record<string, any>> = (res.data as any)?.rows ?? []
    logRes(
      '定期理财 (getLockedProductPosition)',
      {
        count: rows.length,
        items: rows
          .slice(0, 5)
          .map(r => `${r.asset}: amount=${r.totalAmount ?? r.amount}`)
      },
      ms
    )
    return rows.map(r => ({
      asset: r.asset ?? 'UNKNOWN',
      free: r.totalAmount ?? r.amount ?? '0',
      locked: '0',
      usdtValue: 0
    }))
  } catch (e: any) {
    console.log(`  ❌ 定期理财 (${Date.now() - t}ms)`)
    console.log(`     message: ${e.message}`)
    if (e.status) console.log(`     status: ${e.status}`)
    if (e.code) console.log(`     code: ${e.code}`)
    if (e.response?.data)
      console.log(
        `     response: ${JSON.stringify(e.response.data).slice(0, 300)}`
      )
    throw e
  }
}

async function fetchPrices() {
  const t = Date.now()
  const res = await fetch(`${SPOT_REST_API_PROD_URL}/api/v3/ticker/price`)
  const ms = Date.now() - t
  const data = (await res.json()) as Array<{symbol: string; price: string}>
  const map: Record<string, string> = {}
  for (const item of data) map[item.symbol] = item.price
  logRes(
    '实时价格 (ticker/price)',
    {
      totalPairs: data.length,
      samples: Object.entries(map)
        .slice(0, 5)
        .map(([s, p]) => `${s}=${p}`)
    },
    ms
  )
  return map
}

function convertToUsdt(
  entries: BalanceEntry[],
  prices: Record<string, string>
): number {
  let total = 0
  for (const entry of entries) {
    const {asset, free, locked} = entry
    if (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(asset)) {
      entry.usdtValue = Number(free) + Number(locked)
    } else {
      const pair = `${asset}USDT`
      const price = prices[pair]
      if (price && Number(price) > 0) {
        entry.usdtValue = (Number(free) + Number(locked)) * Number(price)
      }
    }
    total += entry.usdtValue
  }
  return total
}

// ─── 主流程 ───

async function main() {
  console.log()
  console.log('█'.repeat(60))
  console.log('  币安资产采集测试 (不入库)')
  console.log(`  时间: ${new Date().toISOString()}`)
  console.log('█'.repeat(60))

  // 1. 从 DB 读取 API Key
  logDiv('读取 API Key')
  console.log(`  API Key ID: ${keyId}`)
  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1)

  if (!keyRecord) {
    console.log(`  ❌ API Key #${keyId} 不存在`)
    await db.$client.end()
    process.exit(1)
  }
  if (keyRecord.status !== 'ACTIVE') {
    console.log(`  ❌ API Key #${keyId} 状态为 ${keyRecord.status}`)
    await db.$client.end()
    process.exit(1)
  }

  const rawApiKey = keyRecord.apiKey
  const rawSecret = decrypt(keyRecord.secretEnc)
  console.log(
    `  ✅ API Key: ${rawApiKey.slice(0, 4)}****${rawApiKey.slice(-4)}`
  )
  console.log(`  📛 备注: ${keyRecord.accountLabel ?? '(无)'}`)
  console.log(`  🏛 交易所: ${keyRecord.exchangeId}`)

  // 2. 拉取实时价格
  logDiv('① 拉取实时价格')
  let prices: Record<string, string> = {}
  try {
    prices = await fetchPrices()
  } catch (err) {
    console.log(`  ❌ 价格获取失败: ${(err as Error).message}`)
  }

  // 3. 并行拉取各模块
  logDiv('② 并行拉取各模块余额')
  const results = await Promise.allSettled([
    fetchSpotBalance(rawApiKey, rawSecret).then(v => ({
      name: '① 现货',
      data: v
    })),
    fetchFundingBalance(rawApiKey, rawSecret).then(v => ({
      name: '② 资金',
      data: v
    })),
    fetchFuturesUBalance(rawApiKey, rawSecret).then(v => ({
      name: '③ U本位合约',
      data: v
    })),
    fetchFuturesCoinBalance(rawApiKey, rawSecret).then(v => ({
      name: '④ 币本位合约',
      data: v
    })),
    fetchEarnFlexibleBalance(rawApiKey, rawSecret).then(v => ({
      name: '⑤ 活期理财',
      data: v
    })),
    fetchEarnLockedBalance(rawApiKey, rawSecret).then(v => ({
      name: '⑥ 定期理财',
      data: v
    }))
  ])

  // 4. 汇总
  logDiv('③ 汇总 (USDT)')

  let totalFunding = 0,
    totalSpot = 0,
    totalFuturesU = 0,
    totalFuturesCoin = 0,
    totalEarn = 0

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const {name, data} = result.value
      if (name === '① 现货') {
        totalSpot = convertToUsdt(data as BalanceEntry[], prices)
        console.log(`  ${name}: $${totalSpot.toFixed(2)}`)
        if ((data as BalanceEntry[]).length > 0) {
          console.log(
            `    明细: ${(data as BalanceEntry[])
              .slice(0, 10)
              .map(e => `${e.asset}=${(+e.free + +e.locked).toFixed(4)}`)
              .join(', ')}`
          )
        } else {
          console.log(`    明细: (无余额)`)
        }
      } else if (name === '② 资金') {
        totalFunding = convertToUsdt(data as BalanceEntry[], prices)
        console.log(`  ${name}: $${totalFunding.toFixed(2)}`)
        if ((data as BalanceEntry[]).length > 0) {
          console.log(
            `    明细: ${(data as BalanceEntry[])
              .slice(0, 10)
              .map(e => `${e.asset}=${(+e.free + +e.locked).toFixed(4)}`)
              .join(', ')}`
          )
        } else {
          console.log(`    明细: (无余额)`)
        }
      } else if (name === '③ U本位合约') {
        const d = data as {walletBalance: string; unrealizedPnl: string}
        totalFuturesU = Number(d.walletBalance) + Number(d.unrealizedPnl)
        console.log(
          `  ${name}: $${totalFuturesU.toFixed(2)} (钱包=${d.walletBalance} 未实现盈亏=${d.unrealizedPnl})`
        )
      } else if (name === '④ 币本位合约') {
        const d = data as {walletBalance: string; unrealizedPnl: string}
        totalFuturesCoin = Number(d.walletBalance) + Number(d.unrealizedPnl)
        console.log(
          `  ${name}: $${totalFuturesCoin.toFixed(2)} (钱包=${d.walletBalance} 未实现盈亏=${d.unrealizedPnl})`
        )
      } else if (name === '⑤ 活期理财') {
        const v = convertToUsdt(data as BalanceEntry[], prices)
        totalEarn += v
        console.log(`  ${name}: $${v.toFixed(2)}`)
        if ((data as BalanceEntry[]).length > 0) {
          console.log(
            `    明细: ${(data as BalanceEntry[])
              .slice(0, 5)
              .map(e => `${e.asset}=${(+e.free).toFixed(4)}`)
              .join(', ')}`
          )
        } else {
          console.log(`    明细: (无余额)`)
        }
      } else if (name === '⑥ 定期理财') {
        const v = convertToUsdt(data as BalanceEntry[], prices)
        totalEarn += v
        console.log(`  ${name}: $${v.toFixed(2)}`)
        if ((data as BalanceEntry[]).length > 0) {
          console.log(
            `    明细: ${(data as BalanceEntry[])
              .slice(0, 5)
              .map(e => `${e.asset}=${(+e.free).toFixed(4)}`)
              .join(', ')}`
          )
        } else {
          console.log(`    明细: (无余额)`)
        }
      }
    } else {
      const err = result.reason as Error
      console.log(`  ❌ 模块采集失败: ${err.message}`)
    }
  }

  // 5. 总净资产
  logDiv('💰 总净资产')
  const grandTotal =
    totalFunding + totalSpot + totalFuturesU + totalFuturesCoin + totalEarn
  console.log(`  资金:    $${totalFunding.toFixed(2)}`)
  console.log(`  现货:    $${totalSpot.toFixed(2)}`)
  console.log(`  U本位:   $${totalFuturesU.toFixed(2)}`)
  console.log(`  币本位:  $${totalFuturesCoin.toFixed(2)}`)
  console.log(`  理财:    $${totalEarn.toFixed(2)}`)
  console.log(`  ──────────────────`)
  console.log(`  总计:    $${grandTotal.toFixed(2)}`)
  console.log()
  console.log('█'.repeat(60))
  console.log('  采集完成 (未入库)')
  console.log('█'.repeat(60))
  console.log()

  await db.$client.end()
}

main().catch(err => {
  console.error('脚本异常:', err)
  process.exit(1)
})
