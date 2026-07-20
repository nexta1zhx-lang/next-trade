import ccxt from 'ccxt'
import {createHmac} from 'crypto'
import {ProxyAgent, setGlobalDispatcher} from 'undici'
import {config} from '../config.js'
import type {
  TradeAuditRecord,
  TradeCandle,
  TradeMarker
} from '@nexttrade/shared'

// ─── 类型 ───
interface AuditParams {
  apiKey: string
  apiSecret: string
  symbol?: string // 可选，如 "BTC/USDT:USDT"
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  orderId?: string // 可选，指定订单 ID
}

interface RawFill {
  orderId: string
  symbol: string
  side: 'buy' | 'sell'
  price: number
  qty: number
  realizedPnl: number
  commission: number
  commissionAsset: string
  time: number
  tradeId: number
}

interface RawOrder {
  orderId: number
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  status: string
  price: string
  avgPrice: string
  origQty: string
  executedQty: string
  cumQuote: string
  realizedPnl: string
  fee: string
  stopPrice: string
  time: number
  updateTime: number
}

// ─── 工具: 带退避的 fetch ───
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const e = err as Error & {status?: number; rateLimitUntil?: number}
      // Rate limit 或 5xx 错误才重试
      if (
        (e.status && e.status >= 500) ||
        e.message?.includes('rate limit') ||
        e.message?.includes('ban')
      ) {
        if (i < retries - 1) {
          const delay = baseDelay * Math.pow(2, i) // 1s, 2s, 4s
          console.warn(
            `⏳ Rate limited, retrying in ${delay}ms (${i + 1}/${retries})`
          )
          await new Promise(r => setTimeout(r, delay))
          continue
        }
      }
      throw err
    }
  }
  throw new Error('Max retries exceeded')
}

// ─── 构建币安 REST API 签名 ───
function signRequest(
  method: string,
  endpoint: string,
  params: Record<string, string | number>,
  apiKey: string,
  apiSecret: string
): {url: string; headers: Record<string, string>} {
  const baseUrl = 'https://fapi.binance.com'
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const signature = createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex')

  const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`
  const headers = {
    'X-MBX-APIKEY': apiKey,
    'Content-Type': 'application/json'
  }
  return {url, headers}
}

// ─── 全局代理（国内环境访问 Binance 必需）───
if (config.HTTPS_PROXY) {
  const proxyAgent = new ProxyAgent(config.HTTPS_PROXY)
  setGlobalDispatcher(proxyAgent)
  console.log('✓ Binance API will use proxy:', config.HTTPS_PROXY)
}

// ─── 通用币安 REST 请求 ───
async function binanceRequest<T>(
  method: string,
  endpoint: string,
  params: Record<string, string | number>,
  apiKey: string,
  apiSecret: string
): Promise<T> {
  const {url, headers} = signRequest(
    method,
    endpoint,
    params,
    apiKey,
    apiSecret
  )
  const res = await fetch(url, {method, headers})

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 429 || res.status === 418) {
      throw new Error(`rate limit: ${body}`)
    }
    throw new Error(`Binance API ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ─── 1. 校验 API Key 是否为只读 ───
export async function validateReadOnlyKey(
  apiKey: string,
  apiSecret: string
): Promise<{
  valid: boolean
  canTrade?: boolean
  canWithdraw?: boolean
  error?: string
}> {
  try {
    const account = await binanceRequest<{
      canTrade: boolean
      canWithdraw: boolean
      accountType: string
    }>('GET', '/fapi/v2/account', {timestamp: Date.now()}, apiKey, apiSecret)

    return {
      valid: true,
      canTrade: account.canTrade,
      canWithdraw: account.canWithdraw
    }
  } catch (err) {
    const message = (err as Error).message || 'Unknown error'
    // Binance 返回的鉴权错误
    if (message.includes('-2015') || message.includes('Invalid API-key')) {
      return {valid: false, error: 'Invalid API key or secret'}
    }
    if (message.includes('-2014')) {
      return {valid: false, error: 'API-key format invalid'}
    }
    // 网络错误（代理、DNS、超时等）
    return {
      valid: false,
      error: `Unable to reach Binance: ${message}. Check your network/proxy settings.`
    }
  }
}

// ─── 2. 拉取已完成订单 (allOrders) ───
export async function fetchCompletedOrders(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  startTime: number,
  endTime: number,
  orderId?: number
): Promise<RawOrder[]> {
  const params: Record<string, string | number> = {
    symbol: symbol.replace('/', '').replace(':USDT', ''), // "BTC/USDT:USDT" → "BTCUSDT"
    timestamp: Date.now(),
    startTime,
    endTime,
    limit: 100
  }
  if (orderId) params.orderId = orderId

  const orders = await fetchWithRetry(() =>
    binanceRequest<RawOrder[]>(
      'GET',
      '/fapi/v1/allOrders',
      params,
      apiKey,
      apiSecret
    )
  )

  // 只返回已成交 (filled) 的订单
  return orders.filter(o => o.status === 'FILLED')
}

// ─── 3. 拉取用户成交明细 (userTrades) ───
export async function fetchUserTrades(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  startTime: number,
  endTime: number,
  fromId?: number
): Promise<RawFill[]> {
  const params: Record<string, string | number> = {
    symbol: symbol.replace('/', '').replace(':USDT', ''),
    timestamp: Date.now(),
    startTime,
    endTime,
    limit: 100
  }
  if (fromId) params.fromId = fromId

  return fetchWithRetry(() =>
    binanceRequest<RawFill[]>(
      'GET',
      '/fapi/v1/userTrades',
      params,
      apiKey,
      apiSecret
    )
  )
}

// ─── 4. 拉取 1m K 线 ───
export async function fetchKlines(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  startTime: number,
  endTime: number,
  interval: string = '1m'
): Promise<TradeCandle[]> {
  const ccxtSymbol = symbol // "BTC/USDT:USDT"
  const exchange = new ccxt.binance({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    timeout: 30000,
    options: {defaultType: 'future'},
    ...(config.HTTPS_PROXY
      ? {httpProxy: config.HTTPS_PROXY, httpsProxy: config.HTTPS_PROXY}
      : {})
  })

  const raw = await exchange.fetchOHLCV(
    ccxtSymbol,
    interval,
    startTime,
    undefined,
    // CCXT 会自动处理 limit
    {until: endTime}
  )

  return (raw as any[]).map((c: number[]) => ({
    time: Math.floor((c[0] ?? 0) / 1000),
    open: c[1] ?? 0,
    high: c[2] ?? 0,
    low: c[3] ?? 0,
    close: c[4] ?? 0,
    volume: c[5] ?? 0
  }))
}

// ─── 5. 计算 MAE / MFE ───
interface MAE_MFE {
  mae: number // 最大浮亏 (%)
  mfe: number // 最大浮盈 (%)
  entryIdx: number
  exitIdx: number
}

function calculateMAE_MFE(
  candles: TradeCandle[],
  entryPrice: number,
  side: 'buy' | 'sell'
): MAE_MFE {
  if (candles.length === 0) {
    return {mae: 0, mfe: 0, entryIdx: 0, exitIdx: 0}
  }

  let maxFavorable = -Infinity
  let maxAdverse = Infinity

  for (const c of candles) {
    if (side === 'buy') {
      // 做多: MFE = 最高价有利, MAE = 最低价不利
      const favorable = ((c.high - entryPrice) / entryPrice) * 100
      const adverse = ((c.low - entryPrice) / entryPrice) * 100
      if (favorable > maxFavorable) maxFavorable = favorable
      if (adverse < maxAdverse) maxAdverse = adverse
    } else {
      // 做空: MFE = 最低价有利, MAE = 最高价不利
      const favorable = ((entryPrice - c.low) / entryPrice) * 100
      const adverse = ((entryPrice - c.high) / entryPrice) * 100
      if (favorable > maxFavorable) maxFavorable = favorable
      if (adverse < maxAdverse) maxAdverse = adverse
    }
  }

  return {
    mae: Math.abs(Math.min(maxAdverse, 0)), // MAE 取绝对值
    mfe: Math.max(maxFavorable, 0),
    entryIdx: 0,
    exitIdx: candles.length - 1
  }
}

// ─── 6. 聚合买单/卖单为完整交易 ───
function aggregateTrades(fills: RawFill[]): Array<{
  symbol: string
  side: 'buy' | 'sell'
  entryPrice: number
  exitPrice: number
  realizedPnl: number
  fee: number
  volume: number
  orderId: string
  openedAt: number
  closedAt: number
}> {
  // 按 orderId 分组
  const groups = new Map<string, RawFill[]>()
  for (const f of fills) {
    const key = `${f.orderId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  const trades: Array<{
    symbol: string
    side: 'buy' | 'sell'
    entryPrice: number
    exitPrice: number
    realizedPnl: number
    fee: number
    volume: number
    orderId: string
    openedAt: number
    closedAt: number
  }> = []

  for (const [orderId, orderFills] of groups) {
    const first = orderFills[0]
    const last = orderFills[orderFills.length - 1]

    // 成交量加权均价 (VWAP) 作为入场/出场价
    const totalQty = orderFills.reduce((s, f) => s + f.qty, 0)
    const vwap = orderFills.reduce((s, f) => s + f.price * f.qty, 0) / totalQty

    const totalPnl = orderFills.reduce((s, f) => s + f.realizedPnl, 0)
    const totalFee = orderFills.reduce((s, f) => s + f.commission, 0)

    trades.push({
      symbol: first.symbol,
      side: first.side,
      entryPrice: vwap,
      exitPrice: vwap, // 同一订单内用 VWAP
      realizedPnl: totalPnl,
      fee: totalFee,
      volume: totalQty,
      orderId,
      openedAt: first.time,
      closedAt: last.time
    })
  }

  return trades.sort((a, b) => a.closedAt - b.closedAt)
}

// ─── 7. 主入口: 执行完整审计 ───
export async function runTradeAudit(params: AuditParams): Promise<{
  records: TradeAuditRecord[]
  totalPnl: number
  totalFee: number
  winRate: number
  tradeCount: number
  totalVolume: number
  candles: TradeCandle[]
  markers: TradeMarker[]
}> {
  const {apiKey, apiSecret, symbol, startDate, endDate, orderId} = params
  const startTime = new Date(`${startDate}T00:00:00.000Z`).getTime()
  const endTime = new Date(`${endDate}T23:59:59.999Z`).getTime()

  // 校验时间范围（币安仅保留近 3 个月）
  const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
  if (startTime < threeMonthsAgo) {
    throw new Error(
      `Binance only keeps up to 3 months of history. Start date must be after ${new Date(threeMonthsAgo).toISOString().slice(0, 10)}`
    )
  }

  // 如果没有指定 symbol，用空字符串（后续可改为遍历所有交易对）
  const targetSymbol = symbol || ''

  // 拉取成交明细
  const allTrades: RawFill[] = []
  let fromId: number | undefined

  // 支持按订单 ID 查询
  if (orderId) {
    // 先通过 allOrders 获取 symbol
    const orders = await fetchCompletedOrders(
      apiKey,
      apiSecret,
      targetSymbol || 'BTCUSDT', // 需要至少一个 symbol
      startTime,
      endTime,
      parseInt(orderId)
    )
    if (orders.length === 0) {
      throw new Error(`Order ${orderId} not found or not filled`)
    }
    const orderSymbol = orders[0].symbol

    // 再用 userTrades 获取成交明细
    const trades = await fetchUserTrades(
      apiKey,
      apiSecret,
      orderSymbol,
      startTime,
      endTime
    )
    allTrades.push(...trades.filter(t => t.orderId === orderId))
  } else if (targetSymbol) {
    // 按指定交易对 + 时间段拉取
    do {
      const trades = await fetchUserTrades(
        apiKey,
        apiSecret,
        targetSymbol,
        startTime,
        endTime,
        fromId
      )
      if (trades.length === 0) break
      allTrades.push(...trades)
      fromId = trades[trades.length - 1].tradeId + 1
      // 币安分页限制
      if (trades.length < 100) break
    } while (true)
  } else {
    throw new Error('Either symbol or orderId is required')
  }

  if (allTrades.length === 0) {
    return {
      records: [],
      totalPnl: 0,
      totalFee: 0,
      winRate: 0,
      tradeCount: 0,
      totalVolume: 0,
      candles: [],
      markers: []
    }
  }

  // 聚合为完整交易
  const aggregated = aggregateTrades(allTrades)
  const symbolForKlines = targetSymbol || allTrades[0].symbol

  // 拉取 1m K 线（整个时间范围）
  const candles = await fetchKlines(
    apiKey,
    apiSecret,
    symbolForKlines.includes('/')
      ? symbolForKlines
      : `${symbolForKlines}/USDT:USDT`,
    startTime,
    endTime
  )

  // 计算每条交易的 MAE/MFE
  const records: TradeAuditRecord[] = []
  let winCount = 0
  let totalPnl = 0
  let totalFee = 0
  let totalVolume = 0

  for (const trade of aggregated) {
    // 找到持仓期间的 K 线切片
    const tradeCandles = candles.filter(
      c => c.time * 1000 >= trade.openedAt && c.time * 1000 <= trade.closedAt
    )

    const {mae, mfe} = calculateMAE_MFE(
      tradeCandles,
      trade.entryPrice,
      trade.side
    )

    records.push({
      id: `${trade.orderId}-${trade.side}`,
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      realizedPnl: trade.realizedPnl,
      fee: trade.fee,
      mae,
      mfe,
      openedAt: new Date(trade.openedAt).toISOString(),
      closedAt: new Date(trade.closedAt).toISOString(),
      orderId: trade.orderId,
      volume: trade.volume
    })

    if (trade.realizedPnl > 0) winCount++
    totalPnl += trade.realizedPnl
    totalFee += trade.fee
    totalVolume += trade.volume
  }

  // 生成买卖点标记
  const markers: TradeMarker[] = records.map(r => ({
    time: Math.floor(new Date(r.closedAt).getTime() / 1000),
    position: r.realizedPnl >= 0 ? 'belowBar' : 'aboveBar',
    color: r.realizedPnl >= 0 ? '#22c55e' : '#ef4444',
    shape: r.realizedPnl >= 0 ? 'arrowUp' : 'arrowDown',
    text: `${r.side === 'buy' ? '多' : '空'} $${r.entryPrice.toFixed(2)}`
  }))

  return {
    records,
    totalPnl,
    totalFee,
    winRate: records.length > 0 ? (winCount / records.length) * 100 : 0,
    tradeCount: records.length,
    totalVolume,
    candles,
    markers
  }
}
