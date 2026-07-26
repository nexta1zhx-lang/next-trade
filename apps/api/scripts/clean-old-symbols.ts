/**
 * 清理 daily_market_data 表中旧格式 symbol 数据
 * 旧格式: "BTC/USDT:USDT" → 新格式: "BTCUSDT"
 *
 * 使用: cd apps/api && npx tsx scripts/clean-old-symbols.ts
 */
import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {config} from '../src/config.js'

async function main() {
  const client = postgres(config.DATABASE_URL)
  const db = drizzle(client)

  const [{count}] = await db.execute(
    `SELECT COUNT(*)::int as count FROM daily_market_data WHERE symbol LIKE '%/%'`
  )
  console.log(`旧格式数据: ${count} 条`)

  if (Number(count) > 0) {
    await db.execute(`DELETE FROM daily_market_data WHERE symbol LIKE '%/%'`)
    console.log(`已删除 ${count} 条旧格式数据`)
  } else {
    console.log('没有旧格式数据需要清理')
  }

  process.exit(0)
}

main()
