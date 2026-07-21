import {
  pgTable,
  serial,
  varchar,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core'

/**
 * 历史成交持久化表（增量同步）
 *
 * - 以 userId + exchange + symbol + orderId + tradeId 为唯一键
 * - 拉取前先查最新 closedAt，只拉增量
 * - 打破币安 6 个月限制，实现永久复盘
 */
export const tradeHistory = pgTable(
  'trade_history',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    exchange: varchar('exchange', {length: 20}).notNull(),

    // 成交明细（来自 userTrades）
    symbol: varchar('symbol', {length: 30}).notNull(),
    orderId: varchar('order_id', {length: 50}).notNull(),
    tradeId: varchar('trade_id', {length: 50}).notNull(),
    side: varchar('side', {length: 4}).notNull(),
    price: numeric('price', {precision: 20, scale: 8}).notNull(),
    qty: numeric('qty', {precision: 20, scale: 8}).notNull(),
    realizedPnl: numeric('realized_pnl', {precision: 20, scale: 8}).default(
      '0'
    ),
    commission: numeric('commission', {precision: 20, scale: 8}).default('0'),

    // 计算后的 MAE/MFE
    mae: numeric('mae', {precision: 10, scale: 2}).default('0'),
    mfe: numeric('mfe', {precision: 10, scale: 2}).default('0'),

    // 时间
    tradedAt: timestamp('traded_at').notNull(), // userTrades.time
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    // 唯一键：同一笔成交不重复插入
    userExchangeSymbol: uniqueIndex('idx_th_user_ex_sym').on(
      table.userId,
      table.exchange,
      table.symbol,
      table.orderId,
      table.tradeId
    ),
    // 增量查询：按用户 + 交易所 + 最新时间
    userExchangeTime: index('idx_th_user_ex_time').on(
      table.userId,
      table.exchange,
      table.tradedAt
    )
  })
)
