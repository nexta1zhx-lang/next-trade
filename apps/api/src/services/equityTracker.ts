/**
 * 增量权益追踪引擎
 *
 * 职责:
 *   1. 在线时：WS ACCOUNT_UPDATE → 实时更新 Redis 分钟 bar + 日极值
 *   2. 离线时：REST 校准 → 补齐小时 bar
 *   3. 每小时聚合 Redis ticks → equity_hourly (PostgreSQL)
 *   4. 每日归档日极值 → daily_summaries (PostgreSQL)
 *
 * 权益公式:
 *   totalEquity = futuresWalletBalance + unrealizedPnl + cachedFundingUsdt
 *
 * Redis Key 设计:
 *   asset:bar:{apiKeyId}:{YYYYMMDDHH}  — Hash 小时 bar（实时更新）
 *   asset:daily:{apiKeyId}              — Hash 日极值
 *   asset:baseline:{apiKeyId}           — String JSON 基线
 */

import {db} from '../db/index.js'
import {equityHourly, dailySummaries, apiKeys} from '../db/schema.js'
import {eq, and, sql} from 'drizzle-orm'
import {redis} from './redis.js'

// ─── Lua 脚本（预加载到 Redis，保证原子性） ───

/** 原子更新小时 bar: 设 open(首次) + 更新 H/L/C + 递增 samples */
const LUA_UPDATE_BAR = `
  local open = redis.call('HGET', KEYS[1], 'open')
  if not open then
    redis.call('HMSET', KEYS[1], 'open', ARGV[1], 'high', ARGV[1], 'low', ARGV[1], 'close', ARGV[1], 'samples', 1)
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    return {1, ARGV[1], ARGV[1], ARGV[1], ARGV[1]}
  end
  local curHigh = tonumber(redis.call('HGET', KEYS[1], 'high')) or 0
  local curLow = tonumber(redis.call('HGET', KEYS[1], 'low')) or 0
  local samples = tonumber(redis.call('HGET', KEYS[1], 'samples')) or 0
  local val = tonumber(ARGV[1])
  local newHigh = val
  local newLow = val
  if curHigh > newHigh then newHigh = curHigh end
  if curLow < newLow then newLow = curLow end
  redis.call('HMSET', KEYS[1], 'high', newHigh, 'low', newLow, 'close', val, 'samples', samples + 1)
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return {0, open, newHigh, newLow, val}
`

/** 原子更新日极值: 设 open(首次) + 条件更新 H/L + 更新 close */
const LUA_UPDATE_DAILY = `
  local exists = redis.call('EXISTS', KEYS[1])
  if exists == 0 then
    redis.call('HMSET', KEYS[1], 'openVal', ARGV[1], 'highVal', ARGV[1], 'highTime', ARGV[2], 'lowVal', ARGV[1], 'lowTime', ARGV[2], 'closeVal', ARGV[1], 'updatedAt', ARGV[2])
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    return {1, ARGV[1], ARGV[1], ARGV[1]}
  end
  local curHigh = tonumber(redis.call('HGET', KEYS[1], 'highVal')) or 0
  local curLow = tonumber(redis.call('HGET', KEYS[1], 'lowVal')) or 0
  local val = tonumber(ARGV[1])
  local newHigh = curHigh
  local newLow = curLow
  local highTime = redis.call('HGET', KEYS[1], 'highTime') or ''
  local lowTime = redis.call('HGET', KEYS[1], 'lowTime') or ''
  if val > curHigh then
    newHigh = val
    highTime = ARGV[2]
  end
  if val < curLow then
    newLow = val
    lowTime = ARGV[2]
  end
  redis.call('HMSET', KEYS[1], 'highVal', newHigh, 'highTime', highTime, 'lowVal', newLow, 'lowTime', lowTime, 'closeVal', val, 'updatedAt', ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return {0, newHigh, newLow, val}
`

// Lua 脚本 SHA 缓存（首次执行后填充）
let updateBarSha: string | null = null
let updateDailySha: string | null = null

async function getBarSha(): Promise<string> {
  if (!updateBarSha)
    updateBarSha = (await redis.script('LOAD', LUA_UPDATE_BAR)) as string
  return updateBarSha!
}

async function getDailySha(): Promise<string> {
  if (!updateDailySha)
    updateDailySha = (await redis.script('LOAD', LUA_UPDATE_DAILY)) as string
  return updateDailySha!
}

// ─── 常量 ───

const HOUR_BAR_PREFIX = 'asset:bar:'
const DAILY_KEY_PREFIX = 'asset:daily:'
const BASELINE_PREFIX = 'asset:baseline:'
const TTL_DAILY = 86_400 // 日极值 24h（每日归档后重置）
const TTL_HOUR_BAR = 7_200 // 小时 bar 保留 2h（聚合后可清理）

// ─── 类型 ───

export interface HourBar {
  open: number
  high: number
  low: number
  close: number
  samples: number
}

export interface DailyExtremes {
  openVal: number
  highVal: number
  highTime: string
  lowVal: number
  lowTime: string
  closeVal: number
  updatedAt: string
}

export interface BaselineData {
  baseEquity: number
  baseTime: string
  lastEquity: number
  fundingUsdt: number
  cumulativePnl: number
}

// ─── Redis Key 工具 ───

function hourBarKey(apiKeyId: number, hourIso: string): string {
  // hourIso: "2026-07-30T14:00:00.000Z" → "asset:bar:42:2026073014"
  const compact = hourIso.replace(/[^0-9]/g, '').slice(0, 10)
  return `${HOUR_BAR_PREFIX}${apiKeyId}:${compact}`
}

function dailyKey(apiKeyId: number): string {
  return `${DAILY_KEY_PREFIX}${apiKeyId}`
}

function baselineKey(apiKeyId: number): string {
  return `${BASELINE_PREFIX}${apiKeyId}`
}

/** 获取当前 UTC 整点 ISO */
function currentHourIso(): string {
  const d = new Date()
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

/** 上一个 UTC 整点 ISO */
function prevHourIso(): string {
  const d = new Date()
  d.setUTCHours(d.getUTCHours() - 1, 0, 0, 0)
  return d.toISOString()
}

// ═══════════════════════════════════════════
// 1. 基线管理
// ═══════════════════════════════════════════

/**
 * 初始化基线（Key 绑定时调用）
 */
export async function initBaseline(
  apiKeyId: number,
  futuresWallet: number,
  unrealizedPnl: number,
  fundingUsdt: number
): Promise<void> {
  const totalEquity = futuresWallet + unrealizedPnl + fundingUsdt
  const data: BaselineData = {
    baseEquity: totalEquity,
    baseTime: new Date().toISOString(),
    lastEquity: totalEquity,
    fundingUsdt,
    cumulativePnl: 0
  }
  await redis.set(baselineKey(apiKeyId), JSON.stringify(data))
  console.log(
    `[equityTracker] 基线初始化 key=${apiKeyId} equity=${totalEquity.toFixed(2)}`
  )
}

/**
 * 获取基线数据
 */
export async function getBaseline(
  apiKeyId: number
): Promise<BaselineData | null> {
  const raw = await redis.get(baselineKey(apiKeyId))
  if (!raw) return null
  return JSON.parse(raw)
}

// ═══════════════════════════════════════════
// 2. 在线：WS 事件处理（实时更新小时 bar + 日极值）
// ═══════════════════════════════════════════

/**
 * 处理 WS ACCOUNT_UPDATE 事件
 * - 更新 Redis 小时 bar（O/H/L/C/samples）
 * - 更新 Redis 日极值（high/low 实时替换）
 */
export async function processWsEquityUpdate(
  apiKeyId: number,
  futuresWallet: number,
  unrealizedPnl: number,
  eventTime: number
): Promise<void> {
  const baseline = await getBaseline(apiKeyId)
  if (!baseline) return // 基线未初始化，跳过

  const totalEquity = futuresWallet + unrealizedPnl + baseline.fundingUsdt
  baseline.lastEquity = totalEquity
  baseline.cumulativePnl = totalEquity - baseline.baseEquity
  await redis.set(baselineKey(apiKeyId), JSON.stringify(baseline))

  // ── 更新小时 bar ──
  const hour = currentHourIso()
  const hKey = hourBarKey(apiKeyId, hour)
  await updateHourBar(hKey, totalEquity, eventTime)

  // ── 更新日极值 ──
  await updateDailyExtremes(apiKeyId, totalEquity, eventTime)
}

/**
 * 原子更新小时 bar（Lua 脚本，消除竞态）
 */
async function updateHourBar(
  hKey: string,
  equity: number,
  _eventTime: number
): Promise<void> {
  try {
    const sha = await getBarSha()
    await redis.evalsha(sha, 1, hKey, String(equity), String(TTL_HOUR_BAR))
  } catch (err) {
    // evalsha 失败时回退到 evalsha + load (script cache flushed)
    const sha2 = (await redis.script('LOAD', LUA_UPDATE_BAR)) as string
    updateBarSha = sha2
    await redis.evalsha(sha2, 1, hKey, String(equity), String(TTL_HOUR_BAR))
  }
}

/**
 * 原子更新日极值（Lua 脚本，消除竞态）
 */
async function updateDailyExtremes(
  apiKeyId: number,
  equity: number,
  eventTime: number
): Promise<void> {
  const dKey = dailyKey(apiKeyId)
  try {
    const sha = await getDailySha()
    await redis.evalsha(
      sha,
      1,
      dKey,
      String(equity),
      String(eventTime),
      String(TTL_DAILY)
    )
  } catch (err) {
    const sha2 = (await redis.script('LOAD', LUA_UPDATE_DAILY)) as string
    updateDailySha = sha2
    await redis.evalsha(
      sha2,
      1,
      dKey,
      String(equity),
      String(eventTime),
      String(TTL_DAILY)
    )
  }
}

// ═══════════════════════════════════════════
// 3. 离线：REST 校准（补齐小时 bar + 日极值）
// ═══════════════════════════════════════════

/**
 * REST 校准 — 离线场景下补齐权益数据
 * 从 REST API 获取完整权益并写入数据库
 */
export async function processRestReconcile(
  apiKeyId: number,
  futuresWallet: number,
  unrealizedPnl: number,
  fundingUsdt: number
): Promise<void> {
  const baseline = await getBaseline(apiKeyId)
  if (!baseline) {
    // 首次 REST 校准 = 初始化基线
    await initBaseline(apiKeyId, futuresWallet, unrealizedPnl, fundingUsdt)
    return
  }

  // 更新缓存的资金账户余额
  baseline.fundingUsdt = fundingUsdt
  const totalEquity = futuresWallet + unrealizedPnl + fundingUsdt
  baseline.lastEquity = totalEquity
  baseline.cumulativePnl = totalEquity - baseline.baseEquity
  await redis.set(baselineKey(apiKeyId), JSON.stringify(baseline))

  const now = Date.now()

  // 更新当前小时 bar
  const hour = currentHourIso()
  const hKey = hourBarKey(apiKeyId, hour)
  await updateHourBar(hKey, totalEquity, now)

  // 更新日极值
  await updateDailyExtremes(apiKeyId, totalEquity, now)
}

// ═══════════════════════════════════════════
// 4. 小时聚合 → PostgreSQL
// ═══════════════════════════════════════════

/**
 * 聚合指定小时的 Redis bar 到 PostgreSQL（每小时 Cron 调用）
 * 也可由 equityProcessor 在小时边界自动触发
 */
export async function aggregateHourBar(
  apiKeyId: number,
  hourIso: string
): Promise<void> {
  const hKey = hourBarKey(apiKeyId, hourIso)
  const raw = await redis.hgetall(hKey)
  if (!raw || !raw.open) return // 该小时无数据

  const hourDate = new Date(hourIso)
  const openVal = parseFloat(raw.open)
  const highVal = parseFloat(raw.high ?? raw.open)
  const lowVal = parseFloat(raw.low ?? raw.open)
  const closeVal = parseFloat(raw.close ?? raw.open)
  const samples = parseInt(raw.samples ?? '0', 10)
  const source = samples > 1 ? 'ws' : 'rest'

  // UPSERT 到 PostgreSQL
  await db
    .insert(equityHourly)
    .values({
      apiKeyId,
      hour: hourDate,
      openVal: String(openVal),
      highVal: String(highVal),
      lowVal: String(lowVal),
      closeVal: String(closeVal),
      samples,
      source
    })
    .onConflictDoUpdate({
      target: [equityHourly.apiKeyId, equityHourly.hour],
      set: {
        openVal: String(openVal),
        highVal: String(highVal),
        lowVal: String(lowVal),
        closeVal: String(closeVal),
        samples,
        source
      }
    })

  // 聚合后清理 Redis 临时数据
  await redis.del(hKey)
}

/**
 * 对所有活跃 Key 聚合上一个完整小时（Cron 调用）
 */
export async function aggregateAllHourlyBars(): Promise<void> {
  const prevHour = prevHourIso()
  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.exchangeId, 'binance'), eq(apiKeys.status, 'ACTIVE')))

  for (const key of keys) {
    try {
      await aggregateHourBar(key.id, prevHour)
    } catch (err) {
      console.error(
        `[equityTracker] 小时聚合失败 key=${key.id}:`,
        (err as Error).message
      )
    }
  }
  console.log(
    `[equityTracker] 小时聚合完成: hour=${prevHour}, keys=${keys.length}`
  )
}

/** 全局运行锁，防止 Cron 重叠 */
const runningAggregate = {current: false}
const runningFinalize = {current: false}
const runningCollect = {current: false}

/**
 * 安全执行聚合（带互斥锁）
 */
export async function aggregateAllHourlyBarsSafe(): Promise<void> {
  if (runningAggregate.current) {
    console.warn('[equityTracker] 小时聚合已在运行，跳过本次触发')
    return
  }
  runningAggregate.current = true
  try {
    await aggregateAllHourlyBars()
  } finally {
    runningAggregate.current = false
  }
}

/**
 * 安全执行日终归档（带互斥锁）
 */
export async function finalizeAllDailyExtremesSafe(
  dateStr: string
): Promise<void> {
  if (runningFinalize.current) {
    console.warn('[equityTracker] 日终归档已在运行，跳过本次触发')
    return
  }
  runningFinalize.current = true
  try {
    await finalizeAllDailyExtremes(dateStr)
  } finally {
    runningFinalize.current = false
  }
}

// ═══════════════════════════════════════════
// 5. 日终归档 → daily_summaries（复用现有表）
// ═══════════════════════════════════════════

/**
 * 归档日极值并重置次日 Redis 缓存
 * 每日 UTC 00:00 由 Cron 调用
 */
export async function finalizeDailyExtremes(
  apiKeyId: number,
  dateStr: string
): Promise<void> {
  const dKey = dailyKey(apiKeyId)
  const raw = await redis.hgetall(dKey)
  if (!raw || !raw.openVal) return // 该日无数据

  const openVal = parseFloat(raw.openVal)
  const highVal = parseFloat(raw.highVal)
  const lowVal = parseFloat(raw.lowVal)
  const closeVal = parseFloat(raw.closeVal)
  const amplitude = lowVal > 0 ? ((highVal - lowVal) / lowVal) * 100 : 0

  const highTime = raw.highTime ? new Date(Number(raw.highTime)) : new Date()
  const lowTime = raw.lowTime ? new Date(Number(raw.lowTime)) : new Date()

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

  // 初始化次日 Redis 极值：openVal = 昨日 closeVal
  const now = Date.now()
  await redis.hset(dKey, {
    openVal: String(closeVal),
    highVal: String(closeVal),
    highTime: String(now),
    lowVal: String(closeVal),
    lowTime: String(now),
    closeVal: String(closeVal),
    updatedAt: String(now)
  })
  await redis.expire(dKey, TTL_DAILY)

  console.log(
    `[equityTracker] 日终归档 key=${apiKeyId} date=${dateStr} ` +
      `O=${openVal.toFixed(2)} H=${highVal.toFixed(2)} L=${lowVal.toFixed(2)} C=${closeVal.toFixed(2)}`
  )
}

/**
 * 对所有活跃 Key 执行日终归档
 */
export async function finalizeAllDailyExtremes(dateStr: string): Promise<void> {
  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.exchangeId, 'binance'), eq(apiKeys.status, 'ACTIVE')))

  for (const key of keys) {
    try {
      await finalizeDailyExtremes(key.id, dateStr)
    } catch (err) {
      console.error(
        `[equityTracker] 日终归档失败 key=${key.id}:`,
        (err as Error).message
      )
    }
  }
  console.log(
    `[equityTracker] 日终归档完成: date=${dateStr}, keys=${keys.length}`
  )
}

// ═══════════════════════════════════════════
// 6. 查询接口
// ═══════════════════════════════════════════

export interface EquitySummary {
  currentEquity: number
  cumulativePnl: number
  simpleRoi: number // 简单ROI = cumulativePnl / baseEquity * 100
  twRoi: number // 时间加权ROI（基于小时 bar 连乘）
  maxDrawdown: number
  dailyExtremes: DailyExtremes | null
  baseline: BaselineData | null
}

/**
 * 获取当前权益摘要
 */
export async function getEquitySummary(
  apiKeyId: number
): Promise<EquitySummary | null> {
  const baseline = await getBaseline(apiKeyId)
  if (!baseline) return null

  // 读取日极值
  const dKey = dailyKey(apiKeyId)
  const rawDaily = await redis.hgetall(dKey)
  const dailyExtremes: DailyExtremes | null = rawDaily?.openVal
    ? {
        openVal: parseFloat(rawDaily.openVal),
        highVal: parseFloat(rawDaily.highVal),
        highTime: rawDaily.highTime ?? '',
        lowVal: parseFloat(rawDaily.lowVal),
        lowTime: rawDaily.lowTime ?? '',
        closeVal: parseFloat(rawDaily.closeVal),
        updatedAt: rawDaily.updatedAt ?? ''
      }
    : null

  // 简单 ROI
  const cumulativePnl = baseline.cumulativePnl
  const simpleRoi =
    baseline.baseEquity > 0 ? (cumulativePnl / baseline.baseEquity) * 100 : 0

  // 时间加权 ROI：从 equity_hourly 计算
  const twRoi = await calcTimeWeightedRoi(apiKeyId)

  // 最大回撤
  const maxDrawdown = await calcMaxDrawdown(apiKeyId)

  return {
    currentEquity: baseline.lastEquity,
    cumulativePnl,
    simpleRoi,
    twRoi,
    maxDrawdown,
    dailyExtremes,
    baseline
  }
}

/**
 * 获取权益曲线（小时 bar 聚合）
 */
export async function getEquityCurve(
  apiKeyId: number,
  days?: number
): Promise<
  Array<{
    hour: string
    openVal: number
    highVal: number
    lowVal: number
    closeVal: number
  }>
> {
  const conditions: any[] = [eq(equityHourly.apiKeyId, apiKeyId)]

  // days 不传或为 0 时返回全部数据
  if (days && days > 0) {
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - days)
    conditions.push(
      sql`${equityHourly.hour} >= ${cutoff.toISOString()}::timestamp`
    )
  }

  const rows = await db
    .select()
    .from(equityHourly)
    .where(and(...conditions))
    .orderBy(equityHourly.hour)

  return rows.map(r => ({
    hour: r.hour instanceof Date ? r.hour.toISOString() : String(r.hour),
    openVal: Number(r.openVal),
    highVal: Number(r.highVal),
    lowVal: Number(r.lowVal),
    closeVal: Number(r.closeVal)
  }))
}

/**
 * 获取今日分时数据（从 Redis 小时 bar 实时读取）
 */
export async function getTodayIntraday(
  apiKeyId: number
): Promise<Array<{time: string; value: number}>> {
  const result: Array<{time: string; value: number}> = []

  // 扫描当天所有小时 bar
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const now = new Date()

  for (let h = today.getUTCHours(); h <= now.getUTCHours(); h++) {
    const hourDate = new Date(today)
    hourDate.setUTCHours(h, 0, 0, 0)
    const hKey = hourBarKey(apiKeyId, hourDate.toISOString())
    try {
      const raw = await redis.hgetall(hKey)
      if (raw?.close) {
        result.push({
          time: hourDate.toISOString(),
          value: parseFloat(raw.close)
        })
      }
    } catch {
      // 单个小时读取失败不阻塞整个查询
    }
  }

  return result
}

// ═══════════════════════════════════════════
// 辅助计算
// ═══════════════════════════════════════════

/**
 * 从 equity_hourly 计算时间加权 ROI
 * TWROI = Π(1 + r_i) - 1, 其中 r_i = (close_i - open_i) / open_i
 */
async function calcTimeWeightedRoi(apiKeyId: number): Promise<number> {
  const rows = await db
    .select({
      openVal: equityHourly.openVal,
      closeVal: equityHourly.closeVal
    })
    .from(equityHourly)
    .where(eq(equityHourly.apiKeyId, apiKeyId))
    .orderBy(equityHourly.hour)

  if (rows.length === 0) return 0

  let twRoi = 1
  for (const r of rows) {
    const open = Number(r.openVal)
    if (open > 0) {
      const periodReturn = (Number(r.closeVal) - open) / open
      twRoi *= 1 + periodReturn
    }
  }
  return (twRoi - 1) * 100
}

/**
 * 从 equity_hourly 计算最大回撤
 * MDD = max(peak - trough) / peak
 */
async function calcMaxDrawdown(apiKeyId: number): Promise<number> {
  const rows = await db
    .select({closeVal: equityHourly.closeVal})
    .from(equityHourly)
    .where(eq(equityHourly.apiKeyId, apiKeyId))
    .orderBy(equityHourly.hour)

  if (rows.length < 2) return 0

  let peak = Number(rows[0].closeVal)
  let maxDd = 0

  for (const r of rows) {
    const val = Number(r.closeVal)
    if (val > peak) peak = val
    const dd = peak > 0 ? ((peak - val) / peak) * 100 : 0
    if (dd > maxDd) maxDd = dd
  }

  return maxDd
}
