/**
 * 下载已完成的异步导出 ZIP 并导入数据库
 * 用法: npx tsx scripts/import-export.ts <apiKeyId> <downloadId>
 */
import {db} from '../src/db/index.js'
import {trades, apiKeys} from '../src/db/schema.js'
import {eq, sql} from 'drizzle-orm'
import crypto from 'crypto'
import {decrypt} from '../src/services/crypto.js'
import AdmZip from 'adm-zip'

function sign(secret: string, qs: string): string {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex')
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote
    else if (ch === ',' && !inQuote) {
      result.push(current)
      current = ''
    } else current += ch
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

async function main() {
  const apiKeyId = Number(process.argv[2] || 2)
  const downloadId = process.argv[3] || '1133745214910119936'

  // 1. 获取 API Key
  const [key] = await db
    .select({apiKey: apiKeys.apiKey, secretEnc: apiKeys.secretEnc})
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error('Key not found')
  const secret = decrypt(key.secretEnc)

  // 2. 查询导出状态拿到下载 URL
  console.log('查询导出任务状态...')
  const ts = Date.now()
  const qs = `downloadId=${downloadId}&recvWindow=60000&timestamp=${ts}`
  const sig = sign(secret, qs)
  const res = await fetch(
    `https://fapi.binance.com/fapi/v1/trade/asyn/id?${qs}&signature=${sig}`,
    {headers: {'X-MBX-APIKEY': key.apiKey}}
  )
  const status = await res.json()
  console.log('状态:', status.status)
  if (status.status !== 'completed' || !status.url) {
    throw new Error('导出未完成: ' + JSON.stringify(status))
  }

  // 3. 下载 ZIP
  console.log('下载 ZIP...')
  const zipRes = await fetch(status.url)
  if (!zipRes.ok) throw new Error('下载失败: ' + zipRes.status)
  const zipBuf = Buffer.from(await zipRes.arrayBuffer())
  console.log('ZIP 大小:', zipBuf.length, 'bytes')

  // 4. 解析 CSV
  const zip = new AdmZip(zipBuf)
  let totalInserted = 0

  for (const entry of zip.getEntries()) {
    if (!entry.name.endsWith('.csv')) continue
    console.log('解析:', entry.name)
    const csvText = entry.getData().toString('utf-8')
    const lines = csvText.split('\n').filter(l => l.trim())
    if (lines.length < 2) {
      console.log('  空文件')
      continue
    }

    const header = parseCsvLine(lines[0])
    const colIdx: Record<string, number> = {}
    header.forEach((h, i) => (colIdx[h.trim()] = i))
    console.log('  列:', header.join(', '))

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
      console.warn('  缺少必需列，跳过')
      continue
    }

    let count = 0
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
          realizedPnl,
          feeUsdt: (row[COL.fee] || '0').split(' ')[0],
          isLiquidation: Math.abs(parseFloat(realizedPnl)) > 100,
          executedAt: new Date(row[COL.time] + 'Z')
        })
        .onConflictDoNothing()
      count++
    }
    totalInserted += count
    console.log(`  导入 ${count} 条`)
  }

  console.log(`\n✅ 总计导入 ${totalInserted} 条成交`)
  process.exit(0)
}

main().catch(err => {
  console.error('❌', err)
  process.exit(1)
})
