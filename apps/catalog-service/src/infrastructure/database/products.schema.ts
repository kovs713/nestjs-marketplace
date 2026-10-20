import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export const products = pgTable(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    sellerId: uuid('seller_id').notNull(), // user-service user.id

    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    imageUrl: text('image_url'),

    idempotencyKey: text('idempotency_key').notNull().default(''),
    requestHash: text('request_hash').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('products_title_len', sql`length(${t.title}) between 1 and 200`),
    check('products_price_minor_nonneg', sql`${t.priceMinor} >= 0`),
    index('products_seller').on(t.sellerId),
    index('products_deleted_at').on(t.deletedAt),

    uniqueIndex('products_seller_idempotency_key')
      .on(t.sellerId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} <> ''`),
  ],
);
