import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  index
} from 'drizzle-orm/pg-core'

/**
 * 交易复盘记录
 *
 * 存储用户对每笔已完成订单的复盘分析、标签评分与笔记
 */
export const tradeReviews = pgTable(
  'trade_reviews',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),

    // 关联审计记录 ID (symbol + orderId 组合)
    tradeAuditId: varchar('trade_audit_id', {length: 100}).notNull(),
    symbol: varchar('symbol', {length: 30}).notNull(),

    // 复盘标签
    strategyTags: jsonb('strategy_tags').$type<string[]>().default([]),
    errorTags: jsonb('error_tags').$type<string[]>().default([]),

    // 评分 (1-5)
    rating: integer('rating').default(3),

    // Markdown 笔记
    notes: text('notes').default(''),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  table => ({
    // 按用户 + 审计 ID 唯一（防止重复提交）
    userIdAuditId: index('idx_review_user_audit').on(
      table.userId,
      table.tradeAuditId
    ),
    userIdCreated: index('idx_review_user_created').on(
      table.userId,
      table.createdAt
    )
  })
)
