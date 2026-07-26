/**
 * 成交记录同步服务
 *
 * 职责:
 *   1. 首次绑 Key: 拉取最近 30 天历史成交（全量）
 *   2. 定时对账: 按 lastTradeId 增量拉取，补漏校验
 *   3. 标准化: Binance 原始成交 → trades 表格式
 *
 * 标准化映射:
 *   Binance side=SIDE positionSide=LONG/ SHORT → OPEN_LONG / CLOSE_LONG / OPEN_SHORT / CLOSE_SHORT
 *   强平单: 通过 realizedPnl 绝对值较大 + commissionAsset=USDT 近似判断
 */

/**
 * 成交记录同步服务 — 原生 fetch + HMAC 签名
 *
 * 使用原生 fetch 替代 Binance SDK 的 sendSignedRequest（后者 resp.data 是函数，非数据）。
 */

import crypto from 'crypto'
import {db} from '../db/index.js'
import {trades, apiKeys} from '../db/schema.js'
import {eq, sql} from 'drizzle-orm'
import {decrypt} from './crypto.js'
import {syncPositionsFromTrades} from './positionService.js'
import AdmZip from 'adm-zip'

const BASE = 'https://fapi.binance.com'
// 并发池配置:
//   syncAllSymbols: 4 workers, 每 worker 错开 600ms, 币种间 delay 300ms
//   incrementalSync: 3 workers, 同上
// 权重: PAGE_LIMIT=100 → 每请求 2 weight; IP 限额 2400/min
const PAGE_LIMIT = 100 // limit≤100 权重2, >100 权重20

// 全量币种缓存（exchangeInfo 极少变化）
let allSymbolsCache: string[] | null = null
let allSymbolsCacheTime = 0
const CACHE_TTL = 28_800_000 // 8 小时

// 全局频率限制状态
let globalRateLimitedUntil = 0
let lastUsedWeight = 0 // 最近一次 X-MBX-USED-WEIGHT-1M
const WEIGHT_LIMIT = 2400 // IP 权重上限
const WEIGHT_SAFE = 1900 // 超过此值主动减速
const WEIGHT_CRITICAL = 2300 // 超过此值暂停当前批次

// ─── 工具函数 ───

function sign(secret: string, qs: string): string {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex')
}

/** 全局速率限制：所有请求前先检查 */
async function waitIfRateLimited(): Promise<void> {
  const now = Date.now()
  if (now < globalRateLimitedUntil) {
    const wait = globalRateLimitedUntil - now
    console.log(`[tradeSync] 全局限流中，等待 ${wait}ms...`)
    await delay(wait)
  }
}

async function signedGet(
  apiKey: string,
  secret: string,
  path: string,
  params: Record<string, unknown>,
  retries = 3
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 随机抖动 0-300ms，打散并发请求防止 thundering herd
    await delay(Math.random() * 300)
    await waitIfRateLimited()

    const ts = Date.now()
    const qsParts = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) qsParts.set(k, String(v))
    qsParts.set('recvWindow', '60000')
    qsParts.set('timestamp', String(ts))
    const qs = qsParts.toString()
    const signature = sign(secret, qs)
    const res = await fetch(`${BASE}${path}?${qs}&signature=${signature}`, {
      headers: {'X-MBX-APIKEY': apiKey}
    })
    if (res.ok) {
      // 监控权重
      const w = parseInt(res.headers.get('X-MBX-USED-WEIGHT-1M') ?? '0', 10)
      lastUsedWeight = w
      if (w > WEIGHT_CRITICAL) {
        console.log(`[tradeSync] 权重 ${w}/${WEIGHT_LIMIT}，暂停当前批次`)
        globalRateLimitedUntil = Date.now() + 10000
      } else if (w > WEIGHT_SAFE) {
        console.log(`[tradeSync] 权重 ${w}/${WEIGHT_LIMIT}，减速`)
        await delay(1000)
      }
      return res.json()
    }
    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10)
      const wait =
        retryAfter > 0
          ? retryAfter * 1000
          : Math.min(5000 * 2 ** attempt, 60000)
      console.log(
        `[tradeSync] 429 限流，Retry-After: ${retryAfter}s，等待 ${wait}ms`
      )
      // 设置全局限流，阻止其他并发请求
      const until = Date.now() + wait
      if (until > globalRateLimitedUntil) globalRateLimitedUntil = until
      await delay(wait)
      continue
    }
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
}

/**
 * Signed POST — 用于创建异步导出任务等需要 POST 的端点
 * 参数以 x-www-form-urlencoded 形式放在 body 中
 */
async function signedPost(
  apiKey: string,
  secret: string,
  path: string,
  params: Record<string, unknown>,
  retries = 2
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await delay(Math.random() * 500)
    await waitIfRateLimited()

    const ts = Date.now()
    const bodyParts = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) bodyParts.set(k, String(v))
    bodyParts.set('recvWindow', '60000')
    bodyParts.set('timestamp', String(ts))
    const body = bodyParts.toString()
    const signature = sign(secret, body)

    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `${body}&signature=${signature}`
    })
    if (res.ok) {
      const w = parseInt(res.headers.get('X-MBX-USED-WEIGHT-1M') ?? '0', 10)
      if (w > WEIGHT_CRITICAL) globalRateLimitedUntil = Date.now() + 10000
      else if (w > WEIGHT_SAFE) await delay(1000)
      return res.json()
    }
    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10)
      const wait = retryAfter > 0 ? retryAfter * 1000 : 10000
      const until = Date.now() + wait
      if (until > globalRateLimitedUntil) globalRateLimitedUntil = until
      console.log(`[tradeSync] POST 429，等待 ${wait}ms`)
      await delay(wait)
      continue
    }
    const bodyText = await res.text()
    throw new Error(`POST ${res.status}: ${bodyText.slice(0, 200)}`)
  }
}

// ─── 异步导出（30 天历史全量拉取） ───

/**
 * 使用币安异步导出接口批量拉取历史成交
 * GET /fapi/v1/trade/asyn      — 创建导出任务 (权重 1000)
 * GET /fapi/v1/trade/asyn/id   — 查询任务状态 (权重 5)
 *
 * 一次性导出所有币种 30 天成交，返回写入的行数
 * 失败/不可用时返回 -1 供调用方降级
 */
async function asyncExportTrades(
  apiKey: string,
  secret: string,
  apiKeyId: number,
  startTime: number,
  endTime: number
): Promise<number> {
  // 1. 创建导出任务 (GET)
  console.log('[tradeSync] 创建异步导出任务...')
  const createResult = await signedGet(
    apiKey,
    secret,
    '/fapi/v1/trade/asyn',
    {
      startTime,
      endTime
    },
    1
  )
  if (!createResult.downloadId) {
    console.warn(
      '[tradeSync] 异步导出不可用:',
      JSON.stringify(createResult).slice(0, 200)
    )
    return -1
  }
  const downloadId = String(createResult.downloadId)
  console.log(`[tradeSync] 导出任务已创建: ${downloadId}`)

  // 2. 轮询直到完成 (GET, 权重 5)
  let url = ''
  for (let i = 0; i < 120; i++) {
    await delay(5000)
    const statusResult = await signedGet(
      apiKey,
      secret,
      '/fapi/v1/trade/asyn/id',
      {downloadId},
      1
    )
    if (statusResult.status === 'completed') {
      url = statusResult.url
      console.log('[tradeSync] 导出完成，开始下载...')
      break
    }
    if (statusResult.status === 'failed') {
      console.warn('[tradeSync] 导出任务失败，降级到 REST 轮询')
      return -1
    }
    if (i % 6 === 0) console.log(`[tradeSync] 导出进行中... (${i + 1}/120)`)
  }
  if (!url) {
    console.warn('[tradeSync] 导出超时，降级到 REST 轮询')
    return -1
  }

  // 3. 下载 ZIP
  const zipRes = await fetch(url)
  if (!zipRes.ok) {
    console.warn('[tradeSync] ZIP 下载失败 HTTP ' + zipRes.status)
    return -1
  }
  const zipBuf = Buffer.from(await zipRes.arrayBuffer())

  // 4. 解析 ZIP → CSV
  const zip = new AdmZip(zipBuf)
  const entries = zip.getEntries()
  let totalInserted = 0

  for (const entry of entries) {
    if (!entry.name.endsWith('.csv')) continue
    const csvText = entry.getData().toString('utf-8')
    const lines = csvText.split('\n').filter(l => l.trim())
    if (lines.length < 2) continue // 只有表头

    // 解析 CSV 表头
    const header = parseCsvLine(lines[0])
    const colIdx: Record<string, number> = {}
    header.forEach((h, i) => (colIdx[h.trim()] = i))

    // CSV 列名映射 (Binance 异步导出格式)
    const COL = {
      tradeId: colIdx['Trade Id'] ?? colIdx['Trade ID'] ?? -1,
      symbol: colIdx['Symbol'] ?? -1,
      side: colIdx['Side'] ?? -1,
      positionSide: colIdx['Position Side'] ?? -1,
      price: colIdx['Price'] ?? -1,
      qty: colIdx['Quantity'] ?? colIdx['Qty'] ?? -1,
      quoteQty: colIdx['Amount'] ?? colIdx['Quote Qty'] ?? -1,
      realizedPnl: colIdx['Realized Profit'] ?? colIdx['Realized PnL'] ?? -1,
      fee: colIdx['Fee'] ?? colIdx['Commission'] ?? -1,
      time: colIdx['Time(UTC)'] ?? colIdx['Time'] ?? -1
    }

    if (COL.tradeId < 0 || COL.symbol < 0 || COL.price < 0 || COL.time < 0) {
      console.warn(`[tradeSync] CSV 缺少必需字段，跳过:`, header.join(', '))
      continue
    }

    // 逐行解析并入库
    for (let li = 1; li < lines.length; li++) {
      const row = parseCsvLine(lines[li])
      if (row.length < header.length) continue

      const tradeId = row[COL.tradeId]
      const symbol = row[COL.symbol]
      const positionSide = row[COL.positionSide] || 'BOTH'
      const side = row[COL.side]
      const realizedPnl = row[COL.realizedPnl] || '0'

      await db
        .insert(trades)
        .values({
          apiKeyId,
          tradeId,
          symbol,
          marketType: 'PERP',
          side: normalizeSide(side, positionSide),
          price: row[COL.price],
          amount: row[COL.qty],
          quoteQty: row[COL.quoteQty],
          realizedPnl: realizedPnl,
          feeUsdt: (row[COL.fee] || '0').split(' ')[0], // "0.02310900 USDT" → "0.02310900"
          isLiquidation: Math.abs(parseFloat(realizedPnl)) > 100,
          executedAt: new Date(row[COL.time] + 'Z') // "2026-07-05 11:33:20" + Z
        })
        .onConflictDoNothing()
      totalInserted++
    }
  }

  console.log(`[tradeSync] 异步导出完成: ${totalInserted} 条`)
  return totalInserted
}

/** 简易 CSV 行解析（处理引号包裹的字段） */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function normalizeSide(side: string, positionSide: string): string {
  const isBuy = side === 'BUY'
  const isLong = positionSide === 'LONG'
  if (isBuy && isLong) return 'OPEN_LONG'
  if (!isBuy && isLong) return 'CLOSE_LONG'
  if (!isBuy && !isLong) return 'OPEN_SHORT'
  return 'CLOSE_SHORT'
}

function isLikelyLiquidation(trade: any): boolean {
  return Math.abs(parseFloat(trade.realizedPnl ?? '0')) > 100
}

// ─── 获取 Key + 币种列表 ───

async function getKey(
  apiKeyId: number
): Promise<{apiKey: string; secret: string}> {
  const [key] = await db
    .select({
      apiKey: apiKeys.apiKey,
      secretEnc: apiKeys.secretEnc,
      isTestnet: apiKeys.isTestnet
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error(`API Key not found: ${apiKeyId}`)
  return {apiKey: key.apiKey, secret: decrypt(key.secretEnc)}
}

/**
 * 获取需要同步的币种列表
 * 有已有记录时只扫那些币种，否则全量扫
 */
async function fetchSymbols(apiKeyId?: number): Promise<string[]> {
  // 已有成交记录的币种（增量/对账时用）
  if (apiKeyId) {
    try {
      const existing = await db
        .select({symbol: sql<string>`DISTINCT symbol`})
        .from(trades)
        .where(eq(trades.apiKeyId, apiKeyId))
      if (existing.length > 0) {
        const symbols = existing.map(r => r.symbol).sort()
        console.log('[tradeSync] from existing trades:', symbols.length)
        return symbols
      }
    } catch {}
  }
  // 全量保底
  return getAllSymbols()
}

/** 获取全量 USDT 永续合约列表（缓存 8 小时） */
async function getAllSymbols(): Promise<string[]> {
  if (!allSymbolsCache || Date.now() - allSymbolsCacheTime > CACHE_TTL) {
    const res = await fetch(`${BASE}/fapi/v1/exchangeInfo`)
    const json = (await res.json()) as any
    allSymbolsCache = (json.symbols ?? [])
      .filter(
        (sym: any) =>
          sym.contractType === 'PERPETUAL' &&
          sym.quoteAsset === 'USDT' &&
          sym.status === 'TRADING'
      )
      .map((sym: any) => sym.symbol)
      .sort()
    allSymbolsCacheTime = Date.now()
    console.log('[tradeSync] cached', allSymbolsCache!.length, 'symbols')
  }
  return allSymbolsCache ?? []
}

// ─── 单币种同步 ───

interface SyncResult {
  symbol: string
  insertedCount: number
  lastTradeId: string | null
}

async function syncSymbol(
  apiKey: string,
  secret: string,
  apiKeyId: number,
  symbol: string,
  startTime?: number
): Promise<SyncResult> {
  let insertedCount = 0
  let lastTradeId: string | null = null
  const now = Date.now()
  const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000
  let windowStart = startTime ?? now - 30 * 24 * 60 * 60 * 1000
  if (windowStart < sixMonthsAgo) windowStart = sixMonthsAgo

  // 7天窗口迭代，每窗口第一页传 startTime+endTime，后续用 fromId 翻页
  while (windowStart < now) {
    let windowEnd = windowStart + 7 * 24 * 60 * 60 * 1000
    if (windowEnd > now) windowEnd = now
    let fromId: number | undefined

    for (let page = 0; page < 30; page++) {
      const params: Record<string, unknown> = {symbol, limit: PAGE_LIMIT}
      if (fromId) {
        params.fromId = fromId
      } else {
        params.startTime = windowStart
        params.endTime = windowEnd
      }

      const rows: any[] = await signedGet(
        apiKey,
        secret,
        '/fapi/v1/userTrades',
        params
      )
      if (!Array.isArray(rows) || rows.length === 0) break

      for (const row of rows) {
        await db
          .insert(trades)
          .values({
            apiKeyId,
            tradeId: String(row.id),
            symbol: row.symbol,
            marketType: 'PERP',
            side: normalizeSide(row.side, row.positionSide ?? 'BOTH'),
            price: String(row.price),
            amount: String(row.qty),
            quoteQty: String(row.quoteQty),
            realizedPnl: String(row.realizedPnl ?? '0'),
            feeUsdt: String(row.commission ?? '0'),
            isLiquidation: isLikelyLiquidation(row),
            executedAt: new Date(Number(row.time))
          })
          .onConflictDoNothing()
        insertedCount++
        lastTradeId = String(row.id)
      }
      if (rows.length < PAGE_LIMIT) break
      fromId = rows[rows.length - 1].id
      await delay(rows.length >= PAGE_LIMIT ? 100 : 150)
    }
    windowStart = windowEnd
  }
  return {symbol, insertedCount, lastTradeId}
}

// ─── 公开 API ───

export async function syncAllSymbols(
  apiKeyId: number,
  startTime?: number,
  forceFullScan = false
): Promise<{totalInserted: number; symbolCount: number}> {
  const {apiKey, secret} = await getKey(apiKeyId)
  if (!startTime) startTime = Date.now() - 30 * 24 * 60 * 60 * 1000

  // ── 首次全量同步：用异步导出接口 ──
  if (forceFullScan) {
    const endTime = Date.now()
    const exported = await asyncExportTrades(
      apiKey,
      secret,
      apiKeyId,
      startTime,
      endTime
    )
    // -1 表示降级，走 REST 轮询
    if (exported >= 0) {
      const symbols = await getAllSymbols()
      console.log(`[tradeSync] Key ${apiKeyId}: ${exported} 条 (异步导出)`)
      await db
        .update(apiKeys)
        .set({lastSyncAt: new Date()})
        .where(eq(apiKeys.id, apiKeyId))
      if (exported > 0) await syncPositionsFromTrades(apiKeyId)
      return {totalInserted: exported, symbolCount: symbols.length}
    }
    // 降级: 继续执行下面的 REST 轮询
  }

  // ── 增量 / 降级模式：REST 轮询 ──
  const symbols = forceFullScan
    ? await getAllSymbols()
    : await fetchSymbols(apiKeyId)
  if (symbols.length === 0) console.log('[tradeSync] no symbols to sync')

  // 并发池：最多 4 个币种同时同步，每个 worker 启动时错开 600ms 避免突发
  const CONCURRENCY = 4
  let totalInserted = 0
  let symbolIdx = 0
  let checkedCount = 0

  async function worker(idx: number): Promise<void> {
    // 错开各 worker 的启动时间
    await delay(idx * 600)
    while (symbolIdx < symbols.length) {
      const sym = symbols[symbolIdx++]
      checkedCount++
      const symStart = performance.now()
      const r = await syncSymbol(apiKey, secret, apiKeyId, sym, startTime)
      totalInserted += r.insertedCount
      // 每 10 个币种或查到成交时打印进度
      if (r.insertedCount > 0) {
        console.log(
          `[tradeSync] ${r.symbol}: ${r.insertedCount} 条 (${((performance.now() - symStart) / 1000).toFixed(1)}s)`
        )
      } else if (checkedCount % 10 === 0 || checkedCount < 10) {
        console.log(
          `[tradeSync] 进度 ${checkedCount}/${symbols.length}, 已查 ${totalInserted} 条`
        )
      }
      // 每完成一个币种，短暂喘息让权重回落
      await delay(300)
    }
  }

  const workers = Array.from(
    {length: Math.min(CONCURRENCY, symbols.length)},
    (_, i) => worker(i)
  )
  await Promise.all(workers)

  await db
    .update(apiKeys)
    .set({lastSyncAt: new Date()})
    .where(eq(apiKeys.id, apiKeyId))
  console.log(
    `[tradeSync] Key ${apiKeyId}: ${totalInserted} 条, ${symbols.length} 币种`
  )

  if (totalInserted > 0) await syncPositionsFromTrades(apiKeyId)
  return {totalInserted, symbolCount: symbols.length}
}

export async function incrementalSync(
  apiKeyId: number
): Promise<{totalInserted: number}> {
  const {apiKey, secret} = await getKey(apiKeyId)
  const symbols = await fetchSymbols(apiKeyId)

  const [key] = await db
    .select({lastSyncAt: apiKeys.lastSyncAt})
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  const startTime =
    key?.lastSyncAt?.getTime() ?? Date.now() - 24 * 60 * 60 * 1000

  // 并发池：最多 3 个币种同时同步，错开启动
  const CONCURRENCY = 3
  let totalInserted = 0
  let symbolIdx = 0
  let checkedCount = 0

  async function incWorker(idx: number): Promise<void> {
    await delay(idx * 600)
    while (symbolIdx < symbols.length) {
      const sym = symbols[symbolIdx++]
      checkedCount++
      const r = await syncSymbol(apiKey, secret, apiKeyId, sym, startTime)
      totalInserted += r.insertedCount
      if (checkedCount % 10 === 0 && r.insertedCount === 0) {
        console.log(
          `[tradeSync] 增量进度 ${checkedCount}/${symbols.length}, 已查 ${totalInserted} 条`
        )
      }
      await delay(300)
    }
  }

  const workers = Array.from(
    {length: Math.min(CONCURRENCY, symbols.length)},
    (_, i) => incWorker(i)
  )
  await Promise.all(workers)

  if (totalInserted > 0) {
    await db
      .update(apiKeys)
      .set({lastSyncAt: new Date()})
      .where(eq(apiKeys.id, apiKeyId))
    await syncPositionsFromTrades(apiKeyId)
  }
  return {totalInserted}
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
