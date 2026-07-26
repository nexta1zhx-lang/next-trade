import 'dotenv/config'
import {db} from '../src/db/index.js'
import {apiKeys} from '../src/db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../src/services/crypto.js'
import crypto from 'crypto'

const FAPI = 'https://fapi.binance.com'
const DAPI = 'https://dapi.binance.com'  // COIN-M
const SAPI = 'https://api.binance.com'   // Spot

function sign(s: string, q: string) { return crypto.createHmac('sha256', s).update(q).digest('hex') }

async function test(apiKey: string, secret: string, base: string, path: string, label: string) {
  const q = `symbol=BTCUSDT&limit=3&recvWindow=60000&timestamp=${Date.now()}`
  const r = await fetch(`${base}${path}?${q}&signature=${sign(secret, q)}`, {headers:{'X-MBX-APIKEY':apiKey}})
  const txt = await r.text()
  try {
    const j = JSON.parse(txt)
    const count = Array.isArray(j) ? j.length : 'N/A'
    console.log(`${label}: status=${r.status} count=${count} ${count > 0 ? '有数据!' : ''}`)
  } catch {
    console.log(`${label}: status=${r.status} ${txt.slice(0, 100)}`)
  }
}

async function main() {
  for (const kid of [3, 2]) {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, kid)).limit(1)
    if (!key) continue
    const ak = key.apiKey, sk = decrypt(key.secretEnc)
    console.log(`\n--- Key ${kid} (${key.accountLabel}) ---`)
    await test(ak, sk, FAPI, '/fapi/v1/userTrades', ' U本位合约')
    await test(ak, sk, SAPI, '/api/v3/myTrades', ' Spot现货  ')
  }
  process.exit(0)
}
main()
