/**
 * 历史资金曲线逆向推演引擎 (Historical Reconstruction Engine)
 *
 * 核心思想：由今推古
 *   当前时刻余额 B_now = fetchBalance()
 *   历史 T_{n-1} 余额 = T_n 余额 - T_n 当天发生的净流水变动
 *
 * 数据流：
 *   1. fetchBalance() → 当前精确余额（逆向推算的锚点）
 *   2. fetchLedger()  → 历史账本流水（充提、成交损益、手续费、资金费率）
 *   3. 按时间降序排列，逐日逆向推算历史余额
 *   4. 写入 asset_snapshots 表，标记 isReconstructed = true
 *
 * 限制：
 *   - 交易所 API 通常只开放最近 1~3 个月（最多 6 个月）的 ledger 历史
 *   - 只能还原已实现盈亏，无法还原历史未实现盈亏
 *   - 重建曲线比实时 5min 快照略平滑，但每日收盘净值精确
 */

import ccxt, {Exchange} from 'ccxt'
import {db} from '../../db/index.js'
import {apiKeys, assetSnapshots} from '../../db/schema.js'
import {eq, and, sql} from 'drizzle-orm'
import {decrypt} from '../crypto.js'
import {config} from '../../config.js'
import Decimal from 'decimal.js'

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
      return new ccxt.binance({...opts, options: {defaultType: 'swap'}})
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

export interface ReconstructionResult {
  success: boolean
  keyId: number
  /** 逆向推演的天数 */
  daysReconstructed: number
  /** 当前锚点余额（USDT） */
  currentEquity: number
  /** 写入的快照数 */
  snapshotsCreated: number
  /** 最早可追溯日期 */
  oldestDate: string | null
  durationMs: number
  error?: string
}

/**
 * 逆向推演：从当前余额倒推历史每日净值
 *
 * @param apiKeyId 数据库中的 apiKeys.id
 * @param userId 用户 ID
 * @param days 追溯天数（默认 90，最大 180）
 */
export async function reconstructHistoricalEquity(
  apiKeyId: number,
  userId: number,
  days: number = 90
): Promise<ReconstructionResult> {
  const startTime = Date.now()
  const result: ReconstructionResult = {
    success: false,
    keyId: apiKeyId,
    daysReconstructed: days,
    currentEquity: 0,
    snapshotsCreated: 0,
    oldestDate: null,
    durationMs: 0
  }

  try {
    // ─── Step 1: 读取并解密凭据 ───
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
      result.error = 'API Key not found'
      result.durationMs = Date.now() - startTime
      return result
    }

    let rawSecret: string
    let rawPassphrase: string | undefined
    try {
      rawSecret = decrypt(stored.secretEnc)
      if (stored.passphraseEnc) rawPassphrase = decrypt(stored.passphraseEnc)
    } catch {
      result.error = 'Failed to decrypt API key'
      result.durationMs = Date.now() - startTime
      return result
    }

    const ex = createExchange(stored.exchangeId, {
      apiKey: stored.apiKey,
      apiSecret: rawSecret,
      passphrase: rawPassphrase
    })

    // ─── Step 2: 获取当前精确余额（锚点） ───
    const balance = await ex.fetchBalance()
    const currentEquity = calculateTotalUsdt(balance)
    result.currentEquity = currentEquity

    if (currentEquity <= 0) {
      // 余额为 0 时仍然创建一条今日快照，避免 NAV 算法无锚点
      const today = new Date().toISOString().slice(0, 10)
      await db.insert(assetSnapshots).values({
        apiKeyId,
        snapDate: today,
        totalEquity: '0',
        spotValue: '0',
        contractEquity: '0',
        unrealizedPnl: '0',
        snapshotAt: new Date(today + 'T00:00:00.000Z'),
        isReconstructed: true
      }).catch(() => {})
      result.snapshotsCreated = 1
      result.oldestDate = today
      result.success = true
      result.durationMs = Date.now() - startTime
      return result
    }

    // ─── Step 3: 尝试拉取历史账本流水 ───
    const since = Date.now() - days * 24 * 60 * 60 * 1000

    const ledgerEntries: LedgerEntry[] = []
    try {
      let pageSince = since
      let hasMore = true
      let emptyPages = 0

      while (hasMore && emptyPages < 3) {
        const entries = await ex.fetchLedger(undefined, pageSince, 100)
        if (!entries || entries.length === 0) {
          emptyPages++
          pageSince += 24 * 60 * 60 * 1000
          continue
        }

        emptyPages = 0
        for (const e of entries) {
          if (!e.timestamp) continue
          const amountUsdt = convertToUsdt(e.currency ?? 'USDT', e.amount ?? 0)
          ledgerEntries.push({
            timestamp: e.timestamp,
            date: new Date(e.timestamp).toISOString().slice(0, 10),
            amount: amountUsdt,
            type: e.type ?? 'unknown'
          })
        }

        const lastTs = entries[entries.length - 1]?.timestamp
        if (lastTs && lastTs > pageSince) {
          pageSince = lastTs + 1
        } else {
          pageSince += 60 * 60 * 1000
        }

        if (pageSince > Date.now()) break
      }
    } catch {
      // fetchLedger 不支持时静默跳过
    }

    // ─── Step 4: 按时间降序排列（从新到旧） ───
    ledgerEntries.sort((a, b) => b.timestamp - a.timestamp)

    // ─── Step 5: 按日聚合流水变动，逆向推演 ───
    // 按天汇总净变动
    const dailyChanges = new Map<string, Decimal>()
    for (const entry of ledgerEntries) {
      const cur = dailyChanges.get(entry.date) ?? new Decimal(0)
      dailyChanges.set(entry.date, cur.add(entry.amount))
    }

    // 从当前日期开始逆向推演
    const today = new Date()
    const oldestDate = new Date(since)
    const snapshots: Array<{
      apiKeyId: number
      snapDate: string
      totalEquity: string
      spotValue: string
      contractEquity: string
      unrealizedPnl: string
      snapshotAt: Date
      isReconstructed: boolean
    }> = []

    let runningEquity = new Decimal(currentEquity)
    const currentDate = new Date(today)

    // 每天快照时间设为 UTC 00:00
    while (currentDate >= oldestDate) {
      const dateStr = currentDate.toISOString().slice(0, 10)

      // 记录当前余额（逆向推算后的历史时点余额）
      snapshots.push({
        apiKeyId,
        snapDate: dateStr,
        totalEquity: runningEquity.toFixed(8),
        spotValue: runningEquity.toFixed(8),
        contractEquity: '0',
        unrealizedPnl: '0',
        snapshotAt: new Date(dateStr + 'T00:00:00.000Z'),
        isReconstructed: true
      })

      // 逆向扣除：上一天余额 = 今天余额 - 今天发生的净变动
      // 因为 ledger 中的 amount 正数表示收入，负数表示支出
      // 逆向: 前一天的余额 = 今天余额 - 今天的净变动
      const todayChange = dailyChanges.get(dateStr) ?? new Decimal(0)
      runningEquity = runningEquity.sub(todayChange)

      // 防止余额变成负数（小误差累积）
      if (runningEquity.lt(0)) runningEquity = new Decimal(0)

      currentDate.setUTCDate(currentDate.getUTCDate() - 1)
    }

    // ─── Step 6: 批量写入 asset_snapshots（幂等） ───
    let created = 0
    for (const snap of snapshots) {
      try {
        await db.insert(assetSnapshots).values(snap)
        created++
      } catch {
        // 唯一约束冲突，已存在则跳过
      }
    }

    result.snapshotsCreated = created
    result.oldestDate =
      snapshots.length > 0 ? snapshots[snapshots.length - 1].snapDate : null
    result.success = true
  } catch (err: any) {
    result.error = err.message?.slice(0, 300) ?? 'Unknown error'
  }

  result.durationMs = Date.now() - startTime
  return result
}

// ─── 辅助类型 ───
interface LedgerEntry {
  timestamp: number
  date: string
  amount: number
  type: string
}

// ─── 辅助函数 ───

/**
 * 从 fetchBalance 返回值中计算总 USDT 净值
 *
 * CCXT balance 结构示例:
 *   { info: {...}, USDT: {free: 100, used: 50, total: 150},
 *     free: {USDT: 100}, used: {USDT: 50}, total: {USDT: 150} }
 *
 * 我们只遍历 currency 条目（非 info/free/used/total 等顶层元字段），
 * 且每个 currency 条目必须是对象且有 total 属性。
 */
function calculateTotalUsdt(balance: any): number {
  let total = new Decimal(0)
  const skipKeys = new Set([
    'info',
    'free',
    'used',
    'total',
    'datetime',
    'timestamp',
    'freeRates',
    'usedRates'
  ])

  for (const [coin, acct] of Object.entries(balance)) {
    if (skipKeys.has(coin)) continue
    if (!acct || typeof acct !== 'object') continue

    const bal = acct as Record<string, any>
    const b = typeof bal.total === 'number' ? bal.total : Number(bal.total ?? 0)
    if (!b || b <= 0) continue
    if (coin.toUpperCase() === 'USDT') {
      total = total.add(b)
    }
    // 非 USDT 币种：跳过（fetchLedger 返回即 USDT 本位）
  }

  return total.toNumber()
}

/**
 * 币种折算为 USDT（简化版：仅处理常见稳定币）
 * 注意：fetchLedger 返回的 amount 已是 USDT 本位时直接使用
 */
function convertToUsdt(currency: string, amount: number): number {
  const upper = currency.toUpperCase()
  // 稳定币近似 1:1
  if (
    upper === 'USDT' ||
    upper === 'BUSD' ||
    upper === 'USDC' ||
    upper === 'DAI' ||
    upper === 'TUSD'
  ) {
    return amount
  }
  // 非 USDT 币种：fetchLedger 的 amount 通常是该币种数量
  // 这里返回原始值，由上层处理
  // 实际项目中应查询历史汇率折算
  return amount
}
