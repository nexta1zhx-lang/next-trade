/**
 * Binance U 本位永续合约适配器（精准过滤修复版）
 *
 * 涵盖：API Key 校验、真实持仓过滤、已交易币种精准识别、历史成交 + K线解析
 */

import ccxt from 'ccxt'
import {createHmac} from 'node:crypto'
import {config} from '../config.js'
import type {
  IExchangeAdapter,
  CredentialValidation,
  TradeHistoryQuery,
  TradeHistoryResult
} from './base.adapter.js'
import type {
  ExchangeId,
  ApiCredentials,
  UnifiedPosition,
  PositionSide
} from '../types/position.js'
import type {TradeCandle, TradeMarker} from '@nexttrade/shared'
import {ProxyAgent, setGlobalDispatcher} from 'undici'

if (config.HTTPS_PROXY) {
  setGlobalDispatcher(new ProxyAgent(config.HTTPS_PROXY))
}

/**
 * 🛠️ 防爆工具 1：将任意格式的 Symbol 还原为币安 REST API 原生物理符号 (如 "GRASSUSDT")
 */
function toRawBinanceSymbol(sym: string): string {
  if (!sym) return ''
  let s = sym.split(':')[0].trim()
  if (s.includes('/')) {
    const [base, quote] = s.split('/')
    if (base.endsWith(quote)) return base
    return `${base}${quote}`
  }
  return s
}

/**
 * 🛠️ 防爆工具 2：将任意格式的 Symbol 归一化为 CCXT 标准格式 (如 "GRASS/USDT:USDT")
 */
function toCcxtSymbol(rawOrCcxtSymbol: string, ex?: any): string {
  if (!rawOrCcxtSymbol) return ''

  if (ex) {
    const market = ex.safeMarket(rawOrCcxtSymbol)
    if (market && market.symbol) return market.symbol
  }

  let s = rawOrCcxtSymbol.split(':')[0].trim()
  if (s.includes('/')) {
    const [base, quote] = s.split('/')
    const realBase = base.endsWith(quote) ? base.slice(0, -quote.length) : base
    return `${realBase}/${quote}:${quote}`
  }

  let quote = 'USDT'
  if (s.endsWith('USDT')) quote = 'USDT'
  else if (s.endsWith('USDC')) quote = 'USDC'
  else if (s.endsWith('USD')) quote = 'USD'

  const base = s.endsWith(quote) ? s.slice(0, -quote.length) : s
  return `${base}/${quote}:${quote}`
}

function signRequest(
  method: string,
  endpoint: string,
  params: Record<string, string | number>,
  ak: string,
  sk: string
) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const sig = createHmac('sha256', sk).update(qs).digest('hex')
  return {
    url: `https://fapi.binance.com${endpoint}?${qs}&signature=${sig}`,
    headers: {'X-MBX-APIKEY': ak}
  }
}

async function bFetch<T>(
  method: string,
  ep: string,
  params: Record<string, string | number>,
  ak: string,
  sk: string
): Promise<T> {
  const {url, headers} = signRequest(method, ep, params, ak, sk)
  const res = await fetch(url, {method, headers})
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

async function withRetry<T>(fn: () => Promise<T>, n = 3): Promise<T> {
  for (let i = 0; i < n; i++) {
    try {
      return await fn()
    } catch (e: any) {
      if (
        i < n - 1 &&
        (e.message?.includes('rate limit') || (e as any).status >= 500)
      ) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
        continue
      }
      throw e
    }
  }
  throw new Error('Max retries reached')
}

function splitRange(start: number, end: number, gap = 7 * 86400000) {
  const r: Array<{start: number; end: number}> = []
  for (let c = start; c < end; c = Math.min(c + gap, end))
    r.push({start: c, end: Math.min(c + gap, end)})
  return r
}

export class BinanceAdapter implements IExchangeAdapter {
  readonly exchangeId: ExchangeId = 'binance'

  async validateCredentials(c: ApiCredentials): Promise<CredentialValidation> {
    try {
      const a = await bFetch<{canTrade: boolean}>(
        'GET',
        '/fapi/v2/account',
        {timestamp: Date.now()},
        c.apiKey,
        c.apiSecret
      )
      return {valid: true, canTrade: a.canTrade}
    } catch (e: any) {
      const m = e.message || ''
      if (m.includes('-2015') || m.includes('Invalid API-key'))
        return {
          valid: false,
          error: 'Invalid API key or secret (请确认已在币安勾选“允许合约”权限)'
        }
      if (m.includes('-2014'))
        return {valid: false, error: 'API-key format invalid'}
      return {valid: false, error: `Binance: ${m}`}
    }
  }

  /**
   * 抓取当前真实持仓（精准过滤 0 仓位）
   */
  async fetchPositions(c: ApiCredentials): Promise<UnifiedPosition[]> {
    try {
      const ex = this._ex(c)
      await ex.loadMarkets()
      const raw = await ex.fetchPositions()

      return raw
        .filter(p => {
          // 📌 核心修复 1：严格直接读取币安原生 positionAmt，大于 0 才视作真实持仓
          const rawAmt = parseFloat(p.info?.positionAmt || '0')
          return Math.abs(rawAmt) > 0
        })
        .map(p => {
          const rawAmt = parseFloat(p.info?.positionAmt || '0')
          const side: PositionSide =
            (p.side as PositionSide) || (rawAmt < 0 ? 'short' : 'long')

          const market = ex.safeMarket(p.symbol || p.info?.symbol)
          const symbol = market.symbol || p.symbol || p.info?.symbol || ''
          const mm = (p.marginMode as string) ?? 'cross'
          const baseAmount = Math.abs(rawAmt)

          return {
            id: `binance:${symbol}:${side}`,
            exchange: 'binance',
            symbol,
            rawSymbol: p.info?.symbol ?? p.symbol ?? '',
            side,
            baseAmount,
            notionalUsd: Math.abs(
              p.notional ?? baseAmount * (p.markPrice ?? 0)
            ),
            entryPrice: p.entryPrice ?? 0,
            markPrice: p.markPrice ?? 0,
            unrealizedPnlUsd: p.unrealizedPnl ?? 0,
            unrealizedPnlPercentage: p.percentage ?? 0,
            leverage: p.leverage ?? 1,
            marginType: mm === 'isolated' ? 'isolated' : 'cross',
            updatedAt: p.timestamp ?? Date.now()
          }
        })
    } catch (e: any) {
      console.error('[BinanceAdapter] fetchPositions 抓取失败:', e.message || e)
      throw new Error(`Binance fetchPositions 错误: ${e.message || e}`)
    }
  }

  async fetchTradeHistory(
    c: ApiCredentials,
    q: TradeHistoryQuery
  ): Promise<TradeHistoryResult> {
    const {apiKey: ak, apiSecret: sk} = c
    const st = new Date(`${q.startDate}T00:00:00.000Z`).getTime()
    const et = new Date(`${q.endDate}T23:59:59.999Z`).getTime()
    const syms = q.symbol ? [q.symbol] : await this._discover(ak, sk, st, et)

    // 如果没有任何发生过交易的币种，直接返回空结果
    if (!syms.length) return this._empty()

    interface F {
      orderId: string
      symbol: string
      side: 'buy' | 'sell'
      price: number
      qty: number
      realizedPnl: number
      commission: number
      time: number
      tradeId: number
    }
    const all: F[] = []

    if (q.orderId) {
      const rawSymbol = toRawBinanceSymbol(syms[0])
      const ords = await withRetry(() =>
        bFetch<any[]>(
          'GET',
          '/fapi/v1/allOrders',
          {
            symbol: rawSymbol,
            timestamp: Date.now(),
            startTime: st,
            endTime: et,
            limit: 100
          },
          ak,
          sk
        )
      )
      const filled = ords.filter((o: any) => o.status === 'FILLED')
      if (!filled.length) return this._empty()
      const trades = await this._trades(ak, sk, filled[0].symbol, st, et)
      all.push(...trades.filter((t: any) => String(t.orderId) === q.orderId))
    } else {
      console.log(
        `[BinanceAdapter] Scanning ${syms.length} user-traded symbols: ${syms.join(', ')}`
      )
      for (const sym of syms) {
        for (const {start, end} of splitRange(st, et)) {
          try {
            await new Promise(r => setTimeout(r, 150))
            const t = await this._trades(ak, sk, sym, start, end)
            all.push(...t)
          } catch (e: any) {
            console.warn(
              `[BinanceAdapter] ${sym} userTrades failed: ${e.message?.slice(0, 120)}`
            )
            break
          }
        }
      }
      console.log(`[BinanceAdapter] Total fills fetched: ${all.length}`)
    }

    if (!all.length) return this._empty()
    return this._compute(all)
  }

  async fetchKlines(
    c: ApiCredentials,
    symbol: string,
    st: number,
    et: number
  ): Promise<TradeCandle[]> {
    const ex = this._ex(c)
    await ex.loadMarkets()
    const market = ex.safeMarket(symbol)
    const ccxtSymbol = market.symbol || symbol

    const raw = await ex.fetchOHLCV(ccxtSymbol, '1m', st, undefined, {
      until: et
    })
    return (raw as any[]).map((c: number[]) => ({
      time: Math.floor((c[0] ?? 0) / 1000),
      open: c[1] ?? 0,
      high: c[2] ?? 0,
      low: c[3] ?? 0,
      close: c[4] ?? 0,
      volume: c[5] ?? 0
    }))
  }

  private _ex(c: ApiCredentials) {
    return new ccxt.binance({
      apiKey: c.apiKey,
      secret: c.apiSecret,
      enableRateLimit: true,
      timeout: 30000,
      adjustForTimeDifference: true,
      options: {defaultType: 'future'},
      ...(config.HTTPS_PROXY ? {httpsProxy: config.HTTPS_PROXY} : {})
    })
  }

  /**
   * 自动发现用户真正产生过交易/手续费的 Symbol 列表（精准识别）
   */
  private async _discover(
    ak: string,
    sk: string,
    st: number,
    et: number
  ): Promise<string[]> {
    try {
      const set = new Set<string>()
      for (const {start, end} of splitRange(st, et)) {
        await new Promise(r => setTimeout(r, 150))
        // 不限制 incomeType，抓取 REALIZED_PNL 与 COMMISSION
        const inc = await bFetch<Array<{symbol: string; incomeType: string}>>(
          'GET',
          '/fapi/v1/income',
          {
            timestamp: Date.now(),
            startTime: start,
            endTime: end,
            limit: 1000
          },
          ak,
          sk
        )
        for (const r of inc) {
          if (
            r.symbol &&
            (r.incomeType === 'REALIZED_PNL' || r.incomeType === 'COMMISSION')
          ) {
            const raw = r.symbol
            let quote = 'USDT'
            if (raw.endsWith('USDT')) quote = 'USDT'
            else if (raw.endsWith('USDC')) quote = 'USDC'
            else if (raw.endsWith('USD')) quote = 'USD'
            const base = raw.endsWith(quote) ? raw.slice(0, -quote.length) : raw
            if (base) set.add(`${base}/${quote}:${quote}`)
          }
        }
      }
      return Array.from(set)
    } catch (e: any) {
      console.warn(
        `[BinanceAdapter] _discover failed: ${(e.message || '').slice(0, 120)}`
      )
    }
    // 📌 核心修复 2：彻底移除热门币硬编码兜底！没查到就返回空，绝不乱查没交易过的币种
    return []
  }

  private async _trades(
    ak: string,
    sk: string,
    sym: string,
    st: number,
    et: number
  ): Promise<any[]> {
    const rawSymbol = toRawBinanceSymbol(sym)
    const all: any[] = []
    let fromId: number | undefined

    do {
      const t = await withRetry(() =>
        bFetch<any[]>(
          'GET',
          '/fapi/v1/userTrades',
          {
            symbol: rawSymbol,
            timestamp: Date.now(),
            startTime: st,
            endTime: et,
            limit: 100,
            ...(fromId ? {fromId} : {})
          },
          ak,
          sk
        )
      )
      if (!t.length) break
      all.push(...t)
      fromId = t[t.length - 1].tradeId + 1
      if (t.length < 100) break
    } while (true)
    return all
  }

  private _compute(fills: any[]): TradeHistoryResult {
    const groups = new Map<string, any[]>()
    for (const f of fills) {
      const k = String(f.orderId)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(f)
    }

    const records: any[] = []
    let wins = 0,
      tPnl = 0,
      tFee = 0,
      tVol = 0

    for (const [oid, fs] of groups) {
      const fst = fs[0]
      const lst = fs[fs.length - 1]
      const qty = fs.reduce((s: number, f: any) => s + f.qty, 0)
      const vwap =
        fs.reduce((s: number, f: any) => s + f.price * f.qty, 0) / qty
      const pnl = fs.reduce((s: number, f: any) => s + (f.realizedPnl ?? 0), 0)
      const fee = fs.reduce((s: number, f: any) => s + (f.commission ?? 0), 0)

      records.push({
        id: `${oid}-${fst.side}`,
        symbol: fst.symbol,
        side: fst.side,
        entryPrice: vwap,
        exitPrice: vwap,
        realizedPnl: pnl,
        fee,
        mae: 0,
        mfe: 0,
        openedAt: new Date(fst.time).toISOString(),
        closedAt: new Date(lst.time).toISOString(),
        orderId: oid,
        volume: qty
      })
      if (pnl > 0) wins++
      tPnl += pnl
      tFee += fee
      tVol += qty
    }

    return {
      records,
      totalPnl: tPnl,
      totalFee: tFee,
      winRate: records.length ? (wins / records.length) * 100 : 0,
      tradeCount: records.length,
      totalVolume: tVol,
      candles: [],
      markers: []
    }
  }

  private _empty(): TradeHistoryResult {
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

  async getTradeCandles(
    c: ApiCredentials,
    symbol: string,
    entryPrice: number,
    side: 'buy' | 'sell',
    openedAt: number,
    closedAt: number
  ): Promise<{
    candles: TradeCandle[]
    markers: TradeMarker[]
    mae: number
    mfe: number
  }> {
    const ex = this._ex(c)
    await ex.loadMarkets()
    const ks = toCcxtSymbol(symbol, ex)
    const candles = await this.fetchKlines(c, ks, openedAt, closedAt)

    let mf = -Infinity
    let ma = Infinity

    for (const candle of candles) {
      if (side === 'buy') {
        mf = Math.max(mf, ((candle.high - entryPrice) / entryPrice) * 100)
        ma = Math.min(ma, ((candle.low - entryPrice) / entryPrice) * 100)
      } else {
        mf = Math.max(mf, ((entryPrice - candle.low) / entryPrice) * 100)
        ma = Math.min(ma, ((entryPrice - candle.high) / entryPrice) * 100)
      }
    }

    const mae = Math.abs(Math.min(ma, 0))
    const mfe = Math.max(mf, 0)
    const markers: TradeMarker[] = [
      {
        time: Math.floor(closedAt / 1000),
        position: 'belowBar',
        color: side === 'buy' ? '#22c55e' : '#ef4444',
        shape: side === 'buy' ? 'arrowUp' : 'arrowDown',
        text: `${side === 'buy' ? '买入' : '卖出'} $${entryPrice.toFixed(2)}`
      }
    ]

    return {candles, markers, mae, mfe}
  }
}
