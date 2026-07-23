/**
 * 实盘分析系统 — Drizzle ORM Schema
 *
 * 遵循设计文档中的数据库设计，采用 serial 自增 ID（与现有项目风格一致）。
 *
 * 表清单:
 *   users              — 用户账号
 *   api_keys           — 交易所 API Key（敏感字段 AES-256-GCM 加密存储）
 *   trades             — 标准化成交流水（UNIQUE 联合约束防重）
 *   daily_pnl_summary  — 日汇总盈亏预聚合
 */

import {
  pgTable,
  serial,
  text,
  varchar,
  numeric,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
  jsonb
} from 'drizzle-orm/pg-core'

// ═══════════════════════════════════════════
// 辅助线表
// ═══════════════════════════════════════════
export const symbolDrawings = pgTable(
  'symbol_drawings',
  {
    id: serial('id').primaryKey(),

    /** 关联用户 */
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /** 交易对，如 BTC/USDT:USDT */
    symbol: varchar('symbol', {length: 30}).notNull(),

    /** 辅助线数据 [{id,type,time1,price1,time2?,price2?}] */
    data: jsonb('data').notNull().default([]),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    userSymbolIdx: uniqueIndex('idx_sd_user_symbol').on(
      table.userId,
      table.symbol
    )
  })
)

// ═══════════════════════════════════════════
// 用户表
// ═══════════════════════════════════════════
export const users = pgTable('users', {
  id: serial('id').primaryKey(),

  /** 登录用户名（唯一） */
  username: varchar('username', {length: 50}).unique().notNull(),

  /** argon2id 密码哈希 */
  passwordHash: text('password_hash').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// ═══════════════════════════════════════════
// 交易所 API Key 表（替换原 exchange_keys）
// ═══════════════════════════════════════════
export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),

    /** 关联用户 */
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /** 交易所标识: binance | okx | bybit | bitget | gate | mexc */
    exchangeId: varchar('exchange_id', {length: 30}).notNull(),

    /** 用户自定义账户别名（如"主账户""网格测试账户"） */
    accountLabel: varchar('account_label', {length: 50}).default(''),

    /** 明文 API Key（用于请求交易所） */
    apiKey: text('api_key').notNull(),

    /** AES-256-GCM 加密存储的 Secret */
    secretEnc: text('secret_enc').notNull(),

    /** 加密存储的 Passphrase（OKX 等需要） */
    passphraseEnc: text('passphrase_enc'),

    /** 状态: ACTIVE | INVALID | PAUSED */
    status: varchar('status', {length: 20}).notNull().default('ACTIVE'),

    /** 是否为测试网 */
    isTestnet: integer('is_testnet').default(0),

    /** 上次成功同步时间 */
    lastSyncAt: timestamp('last_sync_at'),

    /** 增量同步断点（交易所原始 trade ID） */
    lastTradeId: varchar('last_trade_id', {length: 100}),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    /** 按用户查询加速 */
    userIdx: index('idx_ak_user').on(table.userId)
  })
)

// ═══════════════════════════════════════════
// 标准化成交流水表
// ═══════════════════════════════════════════
export const trades = pgTable(
  'trades',
  {
    id: serial('id').primaryKey(),

    /** 关联 API Key */
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),

    /** 交易所原始成交 ID（用于去重） */
    tradeId: varchar('trade_id', {length: 100}).notNull(),

    /** 标准化交易对，如 BTC/USDT */
    symbol: varchar('symbol', {length: 30}).notNull(),

    /** 市场类型: SPOT | PERP | FUTURES */
    marketType: varchar('market_type', {length: 20}).notNull(),

    /**
     * 标准化动作:
     *   现货: BUY | SELL
     *   合约: OPEN_LONG | CLOSE_LONG | OPEN_SHORT | CLOSE_SHORT
     */
    side: varchar('side', {length: 20}).notNull(),

    /** 成交均价 */
    price: numeric('price', {precision: 24, scale: 8}).notNull(),

    /** 成交数量 */
    amount: numeric('amount', {precision: 24, scale: 8}).notNull(),

    /** 名义成交金额（USDT 本位） */
    quoteQty: numeric('quote_qty', {precision: 24, scale: 8}).notNull(),

    /** 已实现盈亏（USDT，已包含平仓盈亏） */
    realizedPnl: numeric('realized_pnl', {precision: 24, scale: 8}).default(
      '0'
    ),

    /** 换算为 USDT 的手续费 */
    feeUsdt: numeric('fee_usdt', {precision: 24, scale: 8}).default('0'),

    /** 是否为强平单（强平不参与胜率计算） */
    isLiquidation: boolean('is_liquidation').default(false),

    /** 实际成交时间（UTC） */
    executedAt: timestamp('executed_at').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /**
     * UNIQUE 联合约束: (api_key_id, trade_id)
     * 确保同一交易所的同一笔成交不会重复入库
     * 配合 INSERT … ON CONFLICT DO NOTHING 实现幂等写入
     */
    apiKeyTradeId: uniqueIndex('idx_trades_ak_trade').on(
      table.apiKeyId,
      table.tradeId
    ),

    /** 按 API Key 查询加速 */
    apiKeyIdx: index('idx_trades_ak').on(table.apiKeyId),

    /** 按成交时间范围查询加速 */
    executedAtIdx: index('idx_trades_exec').on(table.executedAt),

    /** 按交易对查询加速 */
    symbolIdx: index('idx_trades_symbol').on(table.symbol)
  })
)

// ═══════════════════════════════════════════
// 日汇总盈亏预聚合表
// ═══════════════════════════════════════════
export const dailyPnlSummary = pgTable(
  'daily_pnl_summary',
  {
    /** 关联用户 */
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /** UTC 结算日期（格式: YYYY-MM-DD） */
    date: varchar('date', {length: 10}).notNull(),

    /** 当日已平仓总盈亏（USDT） */
    realizedPnl: numeric('realized_pnl', {precision: 24, scale: 8}).default(
      '0'
    ),

    /** 当日总手续费（USDT） */
    feeTotal: numeric('fee_total', {precision: 24, scale: 8}).default('0'),

    /** 当日交易笔数 */
    tradeCount: integer('trade_count').default(0),

    /** 盈利交易笔数 */
    winCount: integer('win_count').default(0),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    /** 复合主键: 同一天同一用户只有一条汇总 */
    userDate: uniqueIndex('idx_dps_user_date').on(table.userId, table.date)
  })
)

// ═══════════════════════════════════════════
// 账户余额快照表（每 5 分钟定时采集）
// ═══════════════════════════════════════════
export const accountSnapshots = pgTable(
  'account_snapshots',
  {
    id: serial('id').primaryKey(),

    /** 关联 API Key */
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),

    /** 总净值（USDT 本位，现货余额 + 合约权益） */
    totalNetValue: numeric('total_net_value', {
      precision: 24,
      scale: 8
    }).notNull(),

    /** 现货账户总余额（USDT） */
    spotBalance: numeric('spot_balance', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 合约账户权益（USDT） */
    contractEquity: numeric('contract_equity', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 未实现盈亏（USDT） */
    unrealizedPnl: numeric('unrealized_pnl', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 已用保证金（USDT） */
    marginUsed: numeric('margin_used', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 合约名义持仓价值（USDT） */
    notionalValue: numeric('notional_value', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 快照时间 */
    snapshotAt: timestamp('snapshot_at').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /** 按 Key + 时间查询加速 */
    keyTimeIdx: index('idx_as_key_time').on(table.apiKeyId, table.snapshotAt)
  })
)

// ═══════════════════════════════════════════
// 每日资产快照表（UTC 00:00，用于 NAV 计算）
// ═══════════════════════════════════════════
export const assetSnapshots = pgTable(
  'asset_snapshots',
  {
    id: serial('id').primaryKey(),

    /** 关联 API Key */
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),

    /** 快照日期（YYYY-MM-DD，UTC） */
    snapDate: varchar('snap_date', {length: 10}).notNull(),

    /** 总权益（USDT 本位，含未实现盈亏） */
    totalEquity: numeric('total_equity', {precision: 24, scale: 8}).notNull(),

    /** 现货总市值（USDT） */
    spotValue: numeric('spot_value', {precision: 24, scale: 8}).default('0'),

    /** 合约权益（账户余额 + 未实现盈亏） */
    contractEquity: numeric('contract_equity', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 未实现盈亏 */
    unrealizedPnl: numeric('unrealized_pnl', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 快照时间 */
    snapshotAt: timestamp('snapshot_at').notNull(),
    /** 是否由历史逆向推演生成（非实时快照） */
    isReconstructed: boolean('is_reconstructed').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /** 每天每个 Key 唯一一条 */
    keyDate: uniqueIndex('idx_ass_key_date').on(table.apiKeyId, table.snapDate)
  })
)

// ═══════════════════════════════════════════
// 用户配置表（K 线刷新模式、轮询间隔等）
// ═══════════════════════════════════════════
export const userConfig = pgTable('user_config', {
  userId: integer('user_id')
    .references(() => users.id)
    .primaryKey(),

  /** 刷新模式: 'ws' | 'polling' */
  klineMode: varchar('kline_mode', {length: 10}).default('polling').notNull(),

  /** 轮询间隔（毫秒） */
  klineInterval: integer('kline_interval').default(10000).notNull(),

  /** 全部 Tab 最低成交量过滤（USDT） */
  allMinQuoteVolume: integer('all_min_quote_volume').default(0).notNull(),

  /** 每日 Tab 最低成交量过滤（USDT） */
  dailyMinQuoteVolume: integer('daily_min_quote_volume')
    .default(20000000)
    .notNull(),

  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// ═══════════════════════════════════════════
// 出入金流水表（用于 NAV 计算剔除出入金干扰）
// ═══════════════════════════════════════════
export const capitalFlows = pgTable(
  'capital_flows',
  {
    id: serial('id').primaryKey(),

    /** 关联 API Key */
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),

    /** 流水类型: deposit | withdraw | transfer_in | transfer_out */
    flowType: varchar('flow_type', {length: 20}).notNull(),

    /** 金额（USDT 本位，正数） */
    amount: numeric('amount', {precision: 24, scale: 8}).notNull(),

    /** 发生日期（YYYY-MM-DD，UTC） */
    flowDate: varchar('flow_date', {length: 10}).notNull(),

    /** 备注 */
    note: text('note').default(''),

    /** 发生时间 */
    occurredAt: timestamp('occurred_at').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /** 按 Key + 日期查询加速 */
    keyDateIdx: index('idx_cf_key_date').on(table.apiKeyId, table.flowDate),
    /** 同一笔流水不重复入库 */
    uniqueFlow: uniqueIndex('idx_cf_unique').on(
      table.apiKeyId,
      table.occurredAt,
      table.flowType
    )
  })
)

// ═══════════════════════════════════════════
// 币种标签表
// ═══════════════════════════════════════════
export const symbolTags = pgTable(
  'symbol_tags',
  {
    id: serial('id').primaryKey(),

    /** 关联用户 */
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /** 交易对，如 BTC/USDT:USDT */
    symbol: varchar('symbol', {length: 30}).notNull(),

    /** 标签文本 */
    tag: varchar('tag', {length: 50}).notNull(),

    /** 标签颜色 */
    color: varchar('color', {length: 7}).default('#3b82f6'),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    userSymbolTag: uniqueIndex('idx_st_user_symbol_tag').on(
      table.userId,
      table.symbol,
      table.tag
    )
  })
)

// ═══════════════════════════════════════════
// 交易日记表
// ═══════════════════════════════════════════
export const symbolJournals = pgTable(
  'symbol_journals',
  {
    id: serial('id').primaryKey(),

    /** 关联用户 */
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /** 交易对 */
    symbol: varchar('symbol', {length: 30}).notNull(),

    /** 日记日期 YYYY-MM-DD */
    date: varchar('date', {length: 10}).notNull(),

    /** 标题 */
    title: varchar('title', {length: 200}).default(''),

    /** 内容 */
    content: text('content').notNull().default(''),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    userSymbolDateIdx: index('idx_sj_user_symbol_date').on(
      table.userId,
      table.symbol,
      table.date
    )
  })
)

// ═══════════════════════════════════════════
// 每日行情数据表（每日 UTC 00:05 定时采集）
// ═══════════════════════════════════════════
export const dailyMarketData = pgTable(
  'daily_market_data',
  {
    id: serial('id').primaryKey(),

    /** 日期 YYYY-MM-DD (UTC) */
    date: varchar('date', {length: 10}).notNull(),

    /** 交易所标识 */
    exchange: varchar('exchange', {length: 10}).notNull().default('binance'),

    /** 标准化交易对，如 BTC/USDT:USDT */
    symbol: varchar('symbol', {length: 30}).notNull(),

    /** 基础币种，如 BTC */
    base: varchar('base', {length: 20}).notNull(),

    /** 开盘价 (UTC 00:00) */
    open: numeric('open', {precision: 20, scale: 8}).notNull(),

    /** 北京时间开盘价 (UTC 16:00 当日 1h K 线开盘) */
    openCst8: numeric('open_cst8', {precision: 20, scale: 8}),

    /** 最高价 */
    high: numeric('high', {precision: 20, scale: 8}).notNull(),

    /** 最低价 */
    low: numeric('low', {precision: 20, scale: 8}).notNull(),

    /** 收盘价 */
    close: numeric('close', {precision: 20, scale: 8}).notNull(),

    /** 振幅 % = (high-low)/open * 100 */
    amplitude: numeric('amplitude', {precision: 10, scale: 2}).notNull(),

    /** 涨跌幅 % = (close-open)/open * 100 */
    change: numeric('change', {precision: 10, scale: 2}).notNull(),

    /** USDT 成交额 = close * volume */
    quoteVolume: numeric('quote_volume', {precision: 24, scale: 2}).notNull(),

    /** 十字星标记 (振幅 > 10% 且 |涨跌幅| < 2%) */
    isDoji: boolean('is_doji').default(false),

    /** 振幅排名（1=最大） */
    rankAmplitude: integer('rank_amplitude'),

    /** 涨幅排名（1=最大） */
    rankGain: integer('rank_gain'),

    /** 跌幅排名（1=最大） */
    rankLoss: integer('rank_loss'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    /** 每天同一交易所同一交易对唯一 */
    dateExSymbol: uniqueIndex('idx_dmd_date_ex_symbol').on(
      table.date,
      table.exchange,
      table.symbol
    ),
    /** 按日期+交易所查询加速 */
    dateExIdx: index('idx_dmd_date_ex').on(table.date, table.exchange),
    /** 按日期+振幅排序加速 */
    dateAmpIdx: index('idx_dmd_date_amp').on(table.date, table.amplitude),
    /** 按日期+涨跌幅排序加速 */
    dateChangeIdx: index('idx_dmd_date_change').on(table.date, table.change)
  })
)

// ═══════════════════════════════════════════
// 复盘记录表（每个币种每天一条，含笔记+标签快照）
// ═══════════════════════════════════════════
export const symbolReviews = pgTable(
  'symbol_reviews',
  {
    id: serial('id').primaryKey(),

    /** 关联用户 */
    userId: integer('user_id').references(() => users.id),

    /** 交易对，如 BTC/USDT:USDT */
    symbol: varchar('symbol', {length: 30}).notNull(),

    /** 日期 YYYY-MM-DD */
    date: varchar('date', {length: 10}).notNull(),

    /** 标题 */
    title: varchar('title', {length: 200}).default(''),

    /** 内容 */
    content: text('content').notNull().default(''),

    /** 标签快照 [{"tag":"突破","color":"#22c55e"}] */
    tags: jsonb('tags').default([]),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    /** 每天每币种一条（按用户隔离） */
    symbolDateIdx: uniqueIndex('idx_sr_symbol_date').on(
      table.symbol,
      table.date
    ),
    userIdx: index('idx_sr_user').on(table.userId)
  })
)

// ═══════════════════════════════════════════
// 自选币种表（用户收藏的币种）
// ═══════════════════════════════════════════
export const favoriteSymbols = pgTable(
  'favorite_symbols',
  {
    id: serial('id').primaryKey(),

    /** 关联用户 */
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),

    /** 交易对，如 BTC/USDT:USDT */
    symbol: varchar('symbol', {length: 30}).notNull(),

    /** 基础币种 */
    base: varchar('base', {length: 20}).notNull(),

    /** 加入时的每日行情日期 YYYY-MM-DD */
    date: varchar('date', {length: 10}).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /** 同一用户同一币种唯一 */
    userSymbol: uniqueIndex('idx_fav_user_symbol').on(
      table.userId,
      table.symbol
    )
  })
)
