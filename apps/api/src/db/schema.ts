import {
  pgTable,
  serial,
  text,
  varchar,
  numeric,
  timestamp,
  integer
} from 'drizzle-orm/pg-core'

// ─── 用户 ───
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  walletAddress: varchar('wallet_address', {length: 42}).unique().notNull(),
  nickname: text('nickname'),
  username: varchar('username', {length: 50}).unique(),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// ─── 交易所 API Key ───
export const exchangeKeys = pgTable('exchange_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  label: varchar('label', {length: 50}).default(''), // 用户自定义名称
  exchange: varchar('exchange', {length: 20}).notNull(), // binance | okx | bybit
  apiKey: text('api_key').notNull(),
  apiSecret: text('api_secret').notNull(),
  passphrase: text('passphrase'), // OKX 需要
  isTestnet: integer('is_testnet').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// ─── 订单 ───
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  exchange: varchar('exchange', {length: 20}).notNull(),
  exchangeOrderId: varchar('exchange_order_id', {length: 100}),
  symbol: varchar('symbol', {length: 20}).notNull(),
  side: varchar('side', {length: 4}).notNull(), // buy | sell
  type: varchar('type', {length: 6}).notNull(), // market | limit
  price: numeric('price', {precision: 18, scale: 8}),
  amount: numeric('amount', {precision: 18, scale: 8}).notNull(),
  filled: numeric('filled', {precision: 18, scale: 8}).default('0'),
  status: varchar('status', {length: 10}).default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// ─── 交易复盘 (直接 import from ./schema/trade.js 使用) ───
