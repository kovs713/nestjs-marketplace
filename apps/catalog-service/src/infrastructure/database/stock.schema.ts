import { bigint, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

export type StockProjection = typeof stockProjection.$inferSelect;

export const stockProjection = pgTable('stock_projection', {
  productId: uuid('product_id').primaryKey(),

  inStock: integer('in_stock').notNull().default(0),
  inReserved: integer('in_reserved').notNull().default(0),
  revision: bigint('revision', { mode: 'number' }).notNull(),

  syncedAt: timestamp('synced_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
