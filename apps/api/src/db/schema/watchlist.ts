import {
  pgTable,
  serial,
  varchar,
  numeric,
  timestamp,
  boolean,
  uniqueIndex
} from 'drizzle-orm/pg-core'

export const watchlistSnapshots = pgTable(
  'watchlist_snapshots',
  {
    id: serial('id').primaryKey(),
    symbol: varchar('symbol', {length: 30}).notNull(),
    recordDate: varchar('record_date', {length: 10}).notNull(),
    rank: numeric('rank', {precision: 3, scale: 0}).notNull(),

    // 行情
    lastPrice: numeric('last_price', {precision: 20, scale: 8}).notNull(),
    dayHigh: numeric('day_high', {precision: 20, scale: 8}).notNull(),
    dayLow: numeric('day_low', {precision: 20, scale: 8}).notNull(),
    vwap: numeric('vwap', {precision: 20, scale: 8}).notNull(),
    fib0382: numeric('fib_0382', {precision: 20, scale: 8}).notNull(),
    fib0618: numeric('fib_0618', {precision: 20, scale: 8}).notNull(),

    // 指标
    atr: numeric('atr', {precision: 20, scale: 8}).notNull(),
    amplitude: numeric('amplitude', {precision: 10, scale: 2}).notNull(),
    quoteVolume: numeric('quote_volume', {precision: 24, scale: 2}).notNull(),
    isSqueeze: boolean('is_squeeze').notNull().default(false),
    score: numeric('score', {precision: 8, scale: 2}).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    dateSymbol: uniqueIndex('idx_watchlist_date_symbol').on(
      table.recordDate,
      table.symbol
    )
  })
)
