import {db} from '../src/db/index.js'
import {trades, positions} from '../src/db/schema.js'
import {sql} from 'drizzle-orm'

async function main() {
  const t = await db.select({c: sql<number>`count(*)::int`}).from(trades)
  const p = await db.select({c: sql<number>`count(*)::int`}).from(positions)
  console.log('trades:', t[0]?.c)
  console.log('positions:', p[0]?.c)
  if (t[0]?.c > 0) {
    const samples = await db.select().from(trades).limit(3)
    console.log('side:', samples.map(s => s.side))
    console.log('symbols:', samples.map(s => s.symbol))
    console.log('apiKeyId:', samples.map(s => s.apiKeyId))
  }
  process.exit(0)
}
main()
