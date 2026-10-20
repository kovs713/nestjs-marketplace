import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { orders } from './orders.schema.js';

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(), // catalog-service products.id
    sellerId: uuid('seller_id').notNull(), // denormalized from the product
    // Snapshot so the product can be renamed or deleted after purchase.
    productName: text('product_name').notNull(),

    quantity: integer('quantity').notNull(),
    // NULL in DRAFT, fixed at checkout.
    priceMinor: bigint('price_minor', { mode: 'number' }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'order_items_price_nonneg',
      sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`,
    ),
    uniqueIndex('order_items_order_product').on(t.orderId, t.productId),
  ],
);
