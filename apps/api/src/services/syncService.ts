/**
 * 资产历史快照同步
 *
 * 通过币安官方 SAPI 接口拉取历史资产快照
 *   GET /sapi/v1/accountSnapshot  — 历史资产快照（最近 30 天）
 *
 * 分别拉取 SPOT / FUTURES / MARGIN 三种类型，按日期合并后写入 assetSnapshots
 */

import {createHmac} from 'node:crypto'
import {db} from '../db/index.js'
import {apiKeys, assetSnapshots} from '../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {decrypt} from './crypto.js'

// ─── Binance API 基础 ───

const BASE_SAPI = 'https://api.binance.com'

function signQuery(queryString: string, secret: string): string {
  return createHmac('sha256', secret).update(queryString).digest('hex')
}

async function signedGet<T>(
  apiKey: string,
  secret: string,
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const timestamp = String(Date.now())
  const searchParams = new URLSearchParams({...params, timestamp})
  const signature = signQuery(searchParams.toString(), secret)
  const url = `${BASE_SAPI}${path}?${searchParams}&signature=${signature}`

  const res = await fetch(url, {headers: {'X-MBX-APIKEY': apiKey}})
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Binance API ${path} ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function getKey(apiKeyId: number) {
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error(`API Key ${apiKeyId} not found`)
  if (key.status !== 'ACTIVE')
    throw new Error(`Key ${apiKeyId} is ${key.status}`)
  return key
}

// ─── 拉取单类型快照并折算 USDT ───

/**
 * 注意：不同 type 的 data 结构不同：
 *   SPOT    → data.balances: [{asset, free, locked}]
 *   FUTURES → data.assets:   [{asset, walletBalance, unrealizedProfit}]
 *   MARGIN  → data.userAssets: [{asset, free, locked, borrowed, interest, netAsset}]
 */
async function fetchSnapshots(
  apiKey: string,
  secret: string,
  type: 'SPOT' | 'FUTURES' | 'MARGIN',
  limit = 30
): Promise<Array<{date: string; timestamp: number; totalUsdt: number}>> {
  const raw = await signedGet<any>(apiKey, secret, '/sapi/v1/accountSnapshot', {
    type,
    limit: String(limit)
  })

  if (!raw.snapshotVos || !Array.isArray(raw.snapshotVos)) {
    console.warn(
      `[syncSnapshot] ${type} 返回格式异常:`,
      JSON.stringify(raw).slice(0, 200)
    )
    return []
  }

  return raw.snapshotVos.map((s: any) => {
    const data = s.data || {}
    let totalUsdt = 0

    // SPOT: data.balances
    if (type === 'SPOT' && Array.isArray(data.balances)) {
      for (const b of data.balances) {
        const sum = Number(b.free ?? 0) + Number(b.locked ?? 0)
        if (sum === 0) continue
        if (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(b.asset)) {
          totalUsdt += sum
        }
      }
    }

    // FUTURES: data.assets
    if (type === 'FUTURES' && Array.isArray(data.assets)) {
      for (const a of data.assets) {
        const bal =
          Number(a.walletBalance ?? 0) + Number(a.unrealizedProfit ?? 0)
        if (bal === 0) continue
        if (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(a.asset)) {
          totalUsdt += bal
        }
      }
    }

    // MARGIN: data.userAssets → 用 netAsset
    if (type === 'MARGIN' && Array.isArray(data.userAssets)) {
      for (const a of data.userAssets) {
        const net = Number(a.netAsset ?? 0)
        if (net === 0) continue
        if (['USDT', 'BUSD', 'FDUSD', 'USDC'].includes(a.asset)) {
          totalUsdt += net
        }
      }
    }

    return {
      date: new Date(s.updateTime).toISOString().slice(0, 10),
      timestamp: s.updateTime,
      totalUsdt
    }
  })
}

// ─── 主入口 ───

export interface SyncResult {
  apiKeyId: number
  snapshots: number
}

/**
 * 拉取某 Key 最近 30 天的 SAPI 历史快照，写入 assetSnapshots
 */
export async function syncHistoricalSnapshots(
  apiKeyId: number
): Promise<SyncResult> {
  const key = await getKey(apiKeyId)
  const secret = decrypt(key.secretEnc)

  console.log(`[syncSnapshot] key=${apiKeyId} 拉取 SAPI 历史快照...`)

  // 并行拉取三种类型
  const [spot, futures, margin] = await Promise.all([
    fetchSnapshots(key.apiKey, secret, 'SPOT', 30),
    fetchSnapshots(key.apiKey, secret, 'FUTURES', 30),
    fetchSnapshots(key.apiKey, secret, 'MARGIN', 30)
  ])

  // 按日期合并
  const map = new Map<
    string,
    {spot: number; futures: number; margin: number; ts: number}
  >()
  for (const s of spot) {
    const e = map.get(s.date) ?? {
      spot: 0,
      futures: 0,
      margin: 0,
      ts: s.timestamp
    }
    e.spot = s.totalUsdt
    e.ts = s.timestamp
    map.set(s.date, e)
  }
  for (const s of futures) {
    const e = map.get(s.date) ?? {
      spot: 0,
      futures: 0,
      margin: 0,
      ts: s.timestamp
    }
    e.futures = s.totalUsdt
    e.ts = s.timestamp
    map.set(s.date, e)
  }
  for (const s of margin) {
    const e = map.get(s.date) ?? {
      spot: 0,
      futures: 0,
      margin: 0,
      ts: s.timestamp
    }
    e.margin = s.totalUsdt
    e.ts = s.timestamp
    map.set(s.date, e)
  }

  const dates = Array.from(map.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )
  console.log(`[syncSnapshot] key=${apiKeyId} 合并后 ${dates.length} 天`)

  // 写入 DB
  let written = 0
  for (const [date, val] of dates) {
    // 跳过已有真实快照的日期
    const [existing] = await db
      .select({id: assetSnapshots.id})
      .from(assetSnapshots)
      .where(
        and(
          eq(assetSnapshots.apiKeyId, apiKeyId),
          eq(assetSnapshots.snapDate, date),
          eq(assetSnapshots.isReconstructed, false)
        )
      )
      .limit(1)
    if (existing) continue

    const totalEquity = val.spot + val.futures + val.margin

    try {
      await db
        .insert(assetSnapshots)
        .values({
          apiKeyId,
          snapDate: date,
          totalEquity: String(Math.max(totalEquity, 0)),
          spotValue: String(Math.max(val.spot, 0)),
          contractEquity: String(Math.max(val.futures, 0)),
          unrealizedPnl: '0',
          fundingValue: '0',
          earnValue: '0',
          marginEquity: String(Math.max(val.margin, 0)),
          marginDebt: '0',
          details: {},
          snapshotAt: new Date(val.ts),
          isReconstructed: true
        })
        .onConflictDoUpdate({
          target: [assetSnapshots.apiKeyId, assetSnapshots.snapDate],
          set: {
            totalEquity: String(Math.max(totalEquity, 0)),
            spotValue: String(Math.max(val.spot, 0)),
            contractEquity: String(Math.max(val.futures, 0)),
            marginEquity: String(Math.max(val.margin, 0)),
            isReconstructed: true,
            snapshotAt: new Date(val.ts)
          }
        })
      written++
    } catch (err) {
      console.error(`[syncSnapshot] ${date} 写入失败:`, (err as Error).message)
    }
  }

  console.log(`[syncSnapshot] key=${apiKeyId} 写入 ${written} 条`)
  return {apiKeyId, snapshots: written}
}

/**
 * 对某用户所有 ACTIVE Binance Key 执行历史快照同步
 */
export async function syncAllKeys(userId: number): Promise<SyncResult[]> {
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

  const results: SyncResult[] = []
  for (const k of keys) {
    try {
      results.push(await syncHistoricalSnapshots(k.id))
    } catch (err) {
      console.error(`[syncSnapshot] key=${k.id} 失败:`, (err as Error).message)
    }
  }
  return results
}
