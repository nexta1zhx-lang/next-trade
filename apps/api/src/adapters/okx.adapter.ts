/**
 * OKX U 本位永续合约适配器
 *
 * 📌 核心坑点:
 *   1. 张数(contracts) × contractSize = 真实币数
 *   2. 双向持仓(Hedge Mode)，多空 id 独立
 */

import ccxt from 'ccxt'
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
  PositionSide,
  MarginType
} from '../types/position.js'
import type {TradeCandle, TradeMarker} from '@nexttrade/shared'

export class OkxAdapter implements IExchangeAdapter {
  readonly exchangeId: ExchangeId = 'okx'

  async validateCredentials(c: ApiCredentials): Promise<CredentialValidation> {
    try {
      const ex = this._ex(c)
      await ex.loadMarkets()
      // OKX 没有类似 Binance canTrade 的字段，能成功拉取账户信息即有效
      await ex.fetchBalance()
      return {valid: true, canTrade: false}
    } catch (e: any) {
      return {valid: false, error: `OKX: ${e.message}`}
    }
  }

  async fetchPositions(c: ApiCredentials): Promise<UnifiedPosition[]> {
    const ex = this._ex(c)
    await ex.loadMarkets()
    const raw = await ex.fetchPositions()
    return raw
      .filter(p => (p.contracts ?? 0) !== 0)
      .map(p => {
        const side = p.side as PositionSide
        const rawSymbol = p.symbol ?? ''
        const m = ex.market(rawSymbol)
        const cs = m.contractSize ?? 1
        const mm = (p.marginMode as string) ?? 'cross'
        const baseAmt = Math.abs(p.contracts ?? 0) * cs
        const mp = p.markPrice ?? 0
        const ep = p.entryPrice ?? 0
        const mult = side === 'long' ? 1 : -1
        const upnlPct = ep > 0 ? ((mp - ep) / ep) * 100 * mult : 0
        return {
          id: `okx:${m.symbol}:${side}`,
          exchange: 'okx',
          symbol: m.symbol,
          rawSymbol,
          side,
          baseAmount: baseAmt,
          notionalUsd: baseAmt * mp,
          entryPrice: ep,
          markPrice: mp,
          unrealizedPnlUsd: p.unrealizedPnl ?? 0,
          unrealizedPnlPercentage: upnlPct,
          leverage: p.leverage ?? 1,
          marginType: mm === 'isolated' ? 'isolated' : 'cross',
          updatedAt: p.timestamp ?? Date.now()
        }
      })
  }

  async fetchTradeHistory(
    _c: ApiCredentials,
    _q: TradeHistoryQuery
  ): Promise<TradeHistoryResult> {
    // OKX 历史成交暂未实现
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

  async fetchKlines(
    c: ApiCredentials,
    symbol: string,
    st: number,
    et: number
  ): Promise<TradeCandle[]> {
    const raw = await this._ex(c).fetchOHLCV(symbol, '1m', st, undefined, {
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
    const candles = await this.fetchKlines(c, symbol, openedAt, closedAt)
    return {candles, markers: [], mae: 0, mfe: 0}
  }

  private _ex(c: ApiCredentials) {
    return new ccxt.okx({
      apiKey: c.apiKey,
      secret: c.apiSecret,
      password: c.passphrase ?? '',
      enableRateLimit: true,
      timeout: 30000,
      options: {defaultType: 'swap'},
      ...(config.HTTPS_PROXY
        ? {httpProxy: config.HTTPS_PROXY, httpsProxy: config.HTTPS_PROXY}
        : {})
    })
  }
}
