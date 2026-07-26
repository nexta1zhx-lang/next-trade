import 'dotenv/config'
import {db} from '../src/db/index.js'
import {apiKeys} from '../src/db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../src/services/crypto.js'
import crypto from 'crypto'

const BASE = 'https://fapi.binance.com'
function sign(s: string, q: string) { return crypto.createHmac('sha256', s).update(q).digest('hex') }

async function main() {
  const kid = 3
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, kid)).limit(1)
  if (!key) return
  const ak = key.apiKey, sk = decrypt(key.secretEnc)

  // 1. 测试不带任何时间参数（默认7天）
  let q = 'symbol=BTCUSDT&limit=5&recvWindow=60000&timestamp='+Date.now()
  let r = await fetch(`${BASE}/fapi/v1/userTrades?${q}&signature=${sign(sk, q)}`,{headers:{'X-MBX-APIKEY':ak}})
  console.log('1. 无时间参数:', r.status, (await r.text()).slice(0,300))

  // 2. 测试只传 startTime（7天内）
  let st = Date.now() - 3*86400000
  q = `symbol=BTCUSDT&limit=5&startTime=${st}&recvWindow=60000&timestamp=${Date.now()}`
  r = await fetch(`${BASE}/fapi/v1/userTrades?${q}&signature=${sign(sk, q)}`,{headers:{'X-MBX-APIKEY':ak}})
  console.log('2. startTime=3天前:', r.status, (await r.text()).slice(0,300))

  // 3. 测试 startTime + endTime（7天内）
  st = Date.now() - 7*86400000
  const et = Date.now()
  q = `symbol=BTCUSDT&limit=5&startTime=${st}&endTime=${et}&recvWindow=60000&timestamp=${Date.now()}`
  r = await fetch(`${BASE}/fapi/v1/userTrades?${q}&signature=${sign(sk, q)}`,{headers:{'X-MBX-APIKEY':ak}})
  console.log('3. startTime+endTime 7天:', r.status, (await r.text()).slice(0,300))

  // 4. 测试 fromId
  q = `symbol=BTCUSDT&limit=5&fromId=1&recvWindow=60000&timestamp=${Date.now()}`
  r = await fetch(`${BASE}/fapi/v1/userTrades?${q}&signature=${sign(sk, q)}`,{headers:{'X-MBX-APIKEY':ak}})
  console.log('4. fromId=1:', r.status, (await r.text()).slice(0,300))

  // 5. 试试其他常见币种
  for (const sym of ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','1000PEPEUSDT','WIFUSDT']) {
    const q = `symbol=${sym}&limit=5&recvWindow=60000&timestamp=${Date.now()}`
    const r = await fetch(`${BASE}/fapi/v1/userTrades?${q}&signature=${sign(sk, q)}`,{headers:{'X-MBX-APIKEY':ak}})
    const txt = await r.text()
    const j = JSON.parse(txt)
    if (Array.isArray(j) && j.length > 0) console.log(`5. ${sym}: ${j.length}条`)
    else console.log(`5. ${sym}: 0条`)
  }

  process.exit(0)
}
main()
