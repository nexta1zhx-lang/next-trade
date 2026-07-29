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
 *   account_snapshots  — 每小时资产快照（资产模块核心）
 *   daily_summaries    — 每日资产极值归档（资产K线图）
 *   capital_flows      — 出入金流水
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
// 每小时资产快照表（资产模块核心表）
// ═══════════════════════════════════════════
// 总净资产 = fundingVal + spotVal + futuresUVal + futuresCoinVal + earnVal
export const accountSnapshots = pgTable(
  'account_snapshots',
  {
    id: serial('id').primaryKey(),

    /** 关联 API Key */
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),

    /** 折算总净资产（USDT） */
    totalNetVal: numeric('total_net_val', {
      precision: 24,
      scale: 8
    }).notNull(),

    /** 资金钱包余额（USDT） */
    fundingVal: numeric('funding_val', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 现货总市值（USDT） */
    spotVal: numeric('spot_val', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** U本位合约权益（USDT） */
    futuresUVal: numeric('futures_u_val', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 币本位合约权益（折算 USDT） */
    futuresCoinVal: numeric('futures_coin_val', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 理财持仓价值（USDT） */
    earnVal: numeric('earn_val', {
      precision: 24,
      scale: 8
    }).default('0'),

    /** 各模块详细余额快照（JSON） */
    details: jsonb('details').default('{}'),

    /** 采样时间（UTC） */
    snapshotAt: timestamp('snapshot_at').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /** 按 Key + 时间查询加速 */
    keyTimeIdx: index('idx_as_key_time').on(table.apiKeyId, table.snapshotAt)
  })
)

// ═══════════════════════════════════════════
// 每日资产极值归档表（用于资产 K 线图）
// ═══════════════════════════════════════════
export const dailySummaries = pgTable(
  'daily_summaries',
  {
    id: serial('id').primaryKey(),

    /** 关联 API Key */
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),

    /** 日期（YYYY-MM-DD，UTC） */
    date: varchar('date', {length: 10}).notNull(),

    /** 开盘资产（00:00 UTC） */
    openVal: numeric('open_val', {precision: 24, scale: 8}).notNull(),

    /** 当天最高资产 */
    highVal: numeric('high_val', {precision: 24, scale: 8}).notNull(),

    /** 最高资产发生时间 */
    highTime: timestamp('high_time'),

    /** 当天最低资产 */
    lowVal: numeric('low_val', {precision: 24, scale: 8}).notNull(),

    /** 最低资产发生时间 */
    lowTime: timestamp('low_time'),

    /** 收盘资产（23:59 UTC） */
    closeVal: numeric('close_val', {precision: 24, scale: 8}).notNull(),

    /** 当日振幅百分比 */
    amplitude: numeric('amplitude', {precision: 10, scale: 4}).default('0'),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /** 每天每个 Key 唯一一条 */
    keyDate: uniqueIndex('idx_ds_key_date').on(table.apiKeyId, table.date)
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

  /** 资产展示法币: USD | CNY | EUR | JPY | GBP */
  currency: varchar('currency', {length: 10}).default('USD').notNull(),

  /** 是否自动同步历史资产快照 */
  assetAutoSync: integer('asset_auto_sync').default(1).notNull(),

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

    /** 存储 ISO 时间戳，用于记录实际写入时间 */
    date: varchar('date', {length: 30}).notNull(),

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
    /** 按币种和用户查询加速 */
    symbolDateIdx: index('idx_sr_symbol_date').on(table.symbol),
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

    /** 加入时的每日行情日期 YYYY-MM-DD（不再使用，字段保留兼容） */
    date: varchar('date', {length: 10}).default(''),

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

// ═══════════════════════════════════════════
// 合约仓位表
// ═══════════════════════════════════════════
export const positions = pgTable(
  'positions',
  {
    id: serial('id').primaryKey(),
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),
    symbol: varchar('symbol', {length: 30}).notNull(),
    positionSide: varchar('position_side', {length: 10}).notNull(),
    status: varchar('status', {length: 10}).notNull().default('OPEN'),
    entryPrice: numeric('entry_price', {precision: 24, scale: 8}).notNull(),
    exitPrice: numeric('exit_price', {precision: 24, scale: 8}),
    quantity: numeric('quantity', {precision: 24, scale: 8}).notNull(),
    realizedPnl: numeric('realized_pnl', {precision: 24, scale: 8}).default(
      '0'
    ),
    totalFee: numeric('total_fee', {precision: 24, scale: 8}).default('0'),
    roiPct: numeric('roi_pct', {precision: 10, scale: 4}),
    maxDrawdownPct: numeric('max_drawdown_pct', {precision: 10, scale: 4}),
    holdingSeconds: integer('holding_seconds'),
    isLiquidation: boolean('is_liquidation').default(false),
    entryTradeIds: jsonb('entry_trade_ids').default('[]'),
    exitTradeIds: jsonb('exit_trade_ids').default('[]'),
    openedAt: timestamp('opened_at').notNull(),
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    keyStatusIdx: index('idx_pos_key_status').on(table.apiKeyId, table.status),
    keySymbolIdx: index('idx_pos_key_symbol').on(table.apiKeyId, table.symbol)
  })
)

// ═══════════════════════════════════════════
// 发布设置表（每个用户一条）
// ═══════════════════════════════════════════
export const publishSettings = pgTable('publish_settings', {
  userId: integer('user_id')
    .references(() => users.id)
    .primaryKey(),
  /** 是否公开 */
  isPublic: boolean('is_public').default(false).notNull(),
  /** 公开持仓 */
  showPositions: boolean('show_positions').default(true).notNull(),
  /** 持仓粗细度: basic | full */
  positionGranularity: varchar('position_granularity', {length: 10})
    .default('basic')
    .notNull(),
  /** 公开实盘资金 */
  showCapital: boolean('show_capital').default(false).notNull(),
  /** 公开订单历史 */
  showOrders: boolean('show_orders').default(false).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// ═══════════════════════════════════════════
// 用户关注关系表
// ═══════════════════════════════════════════
export const userFollows = pgTable(
  'user_follows',
  {
    id: serial('id').primaryKey(),
    /** 关注者 */
    followerId: integer('follower_id')
      .references(() => users.id)
      .notNull(),
    /** 被关注者 */
    followingId: integer('following_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    uniqueFollow: uniqueIndex('idx_uf_unique').on(
      table.followerId,
      table.followingId
    ),
    followerIdx: index('idx_uf_follower').on(table.followerId),
    followingIdx: index('idx_uf_following').on(table.followingId)
  })
)

// ═══════════════════════════════════════════
// 增量权益小时 Bar 表（替代旧 account_snapshots 的细化方案）
// ═══════════════════════════════════════════
// equity = futures_wallet_balance + futures_unrealized_pnl + funding_wallet_usdt
// 在线用户: 由 WS ACCOUNT_UPDATE 驱动分钟级 tick，每小时聚合为 bar
// 离线用户: 每小时 REST 拉取 1 次，samples=1
export const equityHourly = pgTable(
  'equity_hourly',
  {
    id: serial('id').primaryKey(),

    /** 关联 API Key */
    apiKeyId: integer('api_key_id')
      .references(() => apiKeys.id)
      .notNull(),

    /** UTC 整点时间，如 2026-07-30 14:00:00 */
    hour: timestamp('hour', {mode: 'date'}).notNull(),

    /** 期初权益 */
    openVal: numeric('open_val', {precision: 24, scale: 8}).notNull(),

    /** 期内最高 */
    highVal: numeric('high_val', {precision: 24, scale: 8}).notNull(),

    /** 期内最低 */
    lowVal: numeric('low_val', {precision: 24, scale: 8}).notNull(),

    /** 期末权益 */
    closeVal: numeric('close_val', {precision: 24, scale: 8}).notNull(),

    /** 该小时内采样次数（在线时 >1，离线时 =1） */
    samples: integer('samples').notNull().default(0),

    /** 数据来源: ws | rest */
    source: varchar('source', {length: 10}).notNull().default('rest'),

    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => ({
    /** 每个 Key 每小时唯一一条 */
    keyHour: uniqueIndex('idx_eh_key_hour').on(table.apiKeyId, table.hour),
    /** 按时间范围查询加速 */
    hourIdx: index('idx_eh_hour').on(table.hour)
  })
)
