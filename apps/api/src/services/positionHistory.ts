/**
 * 币安仓位历史查询（bapi 接口）
 *
 * 使用币安 Web UI 内部 API 直接获取已平仓的仓位级记录，
 * 替代 income + userTrades 的间接推算方式。
 *
 * 接口: POST https://www.binance.com/bapi/futures/v1/private/future/user-data/position/history
 */
import {createHmac} from 'node:crypto'

interface PositionHistoryParams {
  apiKey: string
  apiSecret: string
  pageNo?: number
  pageSize?: number
  symbol?: string
  startTime?: number
  endTime?: number
}

export interface PositionHistoryRecord {
  symbol: string
  positionSide: 'LONG' | 'SHORT'
  positionAmt: string
  entryPrice: string
  markPrice: string
  pnl: string
  roe: string
  realizedPnl: string
  unrealizedPnl: string
  closeTime: string
  openTime: string
}

interface PositionHistoryResponse {
  code: string
  message?: string
  data?: {
    list: PositionHistoryRecord[]
    total: number
    hasNext: boolean
    pageNo: number
    pageSize: number
  }
}

function signBapi(
  params: Record<string, string | number>,
  secret: string
): string {
  const qs = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHmac('sha256', secret).update(qs).digest('hex')
}

/**
 * 查询币安 U 本位合约的已平仓仓位历史
 * 返回仓位级数据（非逐笔成交），每行代表一个完整的已平仓位
 */
export async function fetchPositionHistory(
  params: PositionHistoryParams
): Promise<PositionHistoryRecord[]> {
  const {
    apiKey,
    apiSecret,
    pageNo = 1,
    pageSize = 50,
    symbol,
    startTime,
    endTime
  } = params
  const allRecords: PositionHistoryRecord[] = []
  let currentPage = pageNo
  let hasMore = true

  while (hasMore) {
    const body: Record<string, any> = {
      pageNo: currentPage,
      pageSize
    }
    if (symbol) body.symbol = symbol

    const timestamp = Date.now()
    const queryParams: Record<string, string | number> = {timestamp}

    const signature = signBapi(queryParams, apiSecret)
    const qs = Object.entries({...queryParams, signature})
      .map(([k, v]) => `${k}=${v}`)
      .join('&')

    const url = `https://www.binance.com/bapi/futures/v1/private/future/user-data/position/history?${qs}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Position history API ${res.status}: ${text}`)
    }

    const json = (await res.json()) as PositionHistoryResponse

    if (json.code !== '000000' && json.code !== '200') {
      throw new Error(`Position history error: ${json.message || json.code}`)
    }

    const list = json.data?.list ?? []
    allRecords.push(...list)

    hasMore = !!json.data?.hasNext && list.length >= pageSize
    currentPage++
  }

  return allRecords
}
