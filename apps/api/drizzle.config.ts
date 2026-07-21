import {defineConfig} from 'drizzle-kit'

export default defineConfig({
  schema: [
    './src/db/schema.ts',
    './src/db/schema/volatility.ts',
    './src/db/schema/watchlist.ts',
    './src/db/schema/trade.ts',
    './src/db/schema/trade_history.ts'
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      'postgres://nexttrade:nexttrade@localhost:5432/nexttrade'
  }
})
