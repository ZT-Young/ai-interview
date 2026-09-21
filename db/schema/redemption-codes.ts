import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * redemption_codes —— 兑换码（V1 的支付替代方案）
 *
 * 安全约定：
 * - **只存 SHA-256 哈希，不存明文**（库被读取也无法直接冒用）
 * - 价格与权益由 `product_id` 在服务端查表决定，**不来自请求体**
 * - `used_count` 与 `max_usages` 支持一码多用（如批量投放）
 */
export const redemptionCodes = pgTable(
  'redemption_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 兑换码的 SHA-256 哈希（hex） */
    codeHash: text('code_hash').notNull(),
    /** 服务端商品标识，如 report_unlock / package_10 / subscription_monthly */
    productId: text('product_id').notNull(),
    maxUsages: integer('max_usages').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    disabled: boolean('disabled').notNull().default(false),
    /** 备注，便于运营标记投放渠道 */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeHashUnique: uniqueIndex('redemption_codes_code_hash_unique').on(table.codeHash),
    productIdx: index('redemption_codes_product_idx').on(table.productId),
    usedCountCheck: check(
      'redemption_codes_used_within_max',
      sql`${table.usedCount} >= 0 AND ${table.usedCount} <= ${table.maxUsages}`,
    ),
    maxUsagesCheck: check('redemption_codes_max_usages_positive', sql`${table.maxUsages} > 0`),
  }),
)

export type RedemptionCode = typeof redemptionCodes.$inferSelect
export type NewRedemptionCode = typeof redemptionCodes.$inferInsert
