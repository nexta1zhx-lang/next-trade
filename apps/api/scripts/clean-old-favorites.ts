/**
 * 清理 favorite_symbols 表中旧格式 symbol 数据
 * 旧格式: "BTC/USDT:USDT" → 新格式: "BTCUSDT"
 *
 * 使用: cd apps/api && npx tsx scripts/clean-old-favorites.ts
 */
import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {config} from '../src/config.js'

async function main() {
  const client = postgres(config.DATABASE_URL)
  const db = drizzle(client)

  const [{count}] = await db.execute(
    "SELECT COUNT(*)::int as count FROM favorite_symbols WHERE symbol LIKE '%/%'"
  )
  console.log('旧格式收藏:', count, '条')

  if (Number(count) > 0) {
    await db.execute("DELETE FROM favorite_symbols WHERE symbol LIKE '%/%'")
    console.log('已删除', count, '条')
  } else {
    console.log('没有旧格式收藏需要清理')
  }

  process.exit(0)
}

main()
