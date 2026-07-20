import {
  pgTable,
  serial,
  varchar,
  numeric,
  timestamp,
  integer,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core'

/**
 * 合约每日震荡排行榜
 *
 * 每天每个交易所一条记录，按日期 + 交易所 + 排名唯一
 * 支持按日期回溯查询历史榜单
 */
export const contractVolatilityRank = pgTable(
  'contract_volatility_rank',
  {
    id: serial('id').primaryKey(),
    date: varchar('date', {length: 10}).notNull(), // "2026-07-19"
    exchange: varchar('exchange', {length: 10}).notNull(), // "binance"
    symbol: varchar('symbol', {length: 30}).notNull(), // "BTC/USDT:USDT"
    base: varchar('base', {length: 20}).notNull(), // "BTC"
    rank: integer('rank').notNull(), // 排名 1-20

    // OHLC
    open: numeric('open', {precision: 20, scale: 8}).notNull(),
    high: numeric('high', {precision: 20, scale: 8}).notNull(),
    low: numeric('low', {precision: 20, scale: 8}).notNull(),
    close: numeric('close', {precision: 20, scale: 8}).notNull(),

    // 计算指标
    amplitude: numeric('amplitude', {precision: 10, scale: 2}).notNull(), // 全振幅 %
    body_range: numeric('body_range', {precision: 10, scale: 2}).notNull(), // 实体振幅 %
    upper_wick: numeric('upper_wick', {precision: 10, scale: 2}).notNull(), // 上影线 %
    lower_wick: numeric('lower_wick', {precision: 10, scale: 2}).notNull(), // 下影线 %
    change: numeric('change', {precision: 10, scale: 2}).notNull(), // 涨跌幅 %
    quote_volume: numeric('quote_volume', {precision: 24, scale: 2}).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    // 同一天同一交易所，币种唯一（同名覆盖）
    dateExchangeSymbol: uniqueIndex('idx_vol_date_exchange_symbol').on(
      table.date,
      table.exchange,
      table.symbol
    ),
    // 按日期+交易所+排名查询
    dateExchangeRank: index('idx_vol_date_exchange_rank').on(
      table.date,
      table.exchange,
      table.rank
    )
  })
)
