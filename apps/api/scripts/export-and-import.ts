/**
 * 为指定 Key 创建异步导出并导入数据库
 * 用法: npx tsx scripts/export-and-import.ts <apiKeyId>
 */
import {db} from '../src/db/index.js'
import {trades, apiKeys} from '../src/db/schema.js'
import {eq} from 'drizzle-orm'
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

async function signedGet(
  apiKey: string,
  secret: string,
  path: string,
  params: Record<string, unknown>
): Promise<any> {
  const ts = Date.now()
  const qsParts = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qsParts.set(k, String(v))
  qsParts.set('recvWindow', '60000')
  qsParts.set('timestamp', String(ts))
  const qs = qsParts.toString()
  const signature = sign(secret, qs)
  const res = await fetch(
    `https://fapi.binance.com${path}?${qs}&signature=${signature}`,
    {
      headers: {'X-MBX-APIKEY': apiKey}
    }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  const apiKeyId = Number(process.argv[2] || 3)
  if (!apiKeyId) {
    console.error('Usage: tsx scripts/export-and-import.ts <apiKeyId>')
    process.exit(1)
  }

  // Get key
  const [key] = await db
    .select({
      apiKey: apiKeys.apiKey,
      secretEnc: apiKeys.secretEnc,
      label: apiKeys.accountLabel
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)
  if (!key) throw new Error('Key not found')
  const secret = decrypt(key.secretEnc)
  const apiKeyStr = key.apiKey
  console.log(`处理 Key ${apiKeyId} (${key.label})`)

  // Clear old trades
  await db.delete(trades).where(eq(trades.apiKeyId, apiKeyId))
  console.log('已清空旧数据')

  // Create export
  console.log('创建异步导出任务...')
  const now = Date.now()
  const createResult = await signedGet(
    apiKeyStr,
    secret,
    '/fapi/v1/trade/asyn',
    {
      startTime: now - 30 * 24 * 60 * 60 * 1000,
      endTime: now
    }
  )
  const downloadId = String(createResult.downloadId)
  console.log(`导出任务已创建: ${downloadId}`)

  // Poll
  let url = ''
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const sr = await signedGet(apiKeyStr, secret, '/fapi/v1/trade/asyn/id', {
      downloadId
    })
    if (sr.status === 'completed') {
      url = sr.url
      break
    }
    if (sr.status === 'failed') throw new Error('导出失败')
    if (i % 6 === 0) console.log(`等待中... (${i + 1}/120)`)
  }
  if (!url) throw new Error('导出超时')

  // Download
  console.log('下载 ZIP...')
  const zipRes = await fetch(url)
  const zipBuf = Buffer.from(await zipRes.arrayBuffer())
  const zip = new AdmZip(zipBuf)
  let totalInserted = 0

  for (const entry of zip.getEntries()) {
    if (!entry.name.endsWith('.csv')) continue
    const csvText = entry.getData().toString('utf-8')
    const lines = csvText.split('\n').filter(l => l.trim())
    if (lines.length < 2) continue

    const header = parseCsvLine(lines[0])
    const colIdx: Record<string, number> = {}
    header.forEach((h, i) => (colIdx[h.trim()] = i))

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
      const realizedPnl = row[COL.realizedPnl] || '0'
      await db
        .insert(trades)
        .values({
          apiKeyId,
          tradeId: row[COL.tradeId],
          symbol: row[COL.symbol],
          marketType: 'PERP',
          side: normalizeSide(row[COL.side], row[COL.positionSide] || 'BOTH'),
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
    console.log(`  ${entry.name}: ${count} 条`)
  }

  console.log(`\n✅ Key ${apiKeyId}: 导入 ${totalInserted} 条成交`)
  process.exit(0)
}

main().catch(err => {
  console.error('❌', err)
  process.exit(1)
})
