import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { StoredReservation } from '../reservation/reservation.snapshot.js';

export const reservationStatus = pgEnum('reservation_status', [
  'active',
  'committed',
  'released',
  'expired',
]);

export type Stock = typeof stocks.$inferSelect;
export type NewStock = typeof stocks.$inferInsert;
export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;

// A row exists even before the first hold, serializing the whole order's item set.
export const reservationOrders = pgTable('reservation_orders', {
  orderId: uuid('order_id').primaryKey(),
});

export const reserveIdempotency = pgTable(
  'reserve_idempotency',
  {
    operation: text('operation')
      .$type<'reserve' | 'commit' | 'release'>()
      .notNull()
      .default('reserve'),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').$type<StoredReservation[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.operation, t.key] })],
);

export const stocks = pgTable(
  'stocks',
  {
    productId: uuid('product_id').primaryKey(), // catalog-service products.id

    inStock: integer('in_stock').notNull().default(0),
    inReserved: integer('in_reserved').notNull().default(0),
    revision: bigint('revision', { mode: 'number' }).notNull().default(1),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('stocks_in_stock_nonneg', sql`${t.inStock} >= 0`),
    check('stocks_in_reserved_nonneg', sql`${t.inReserved} >= 0`),
    check('stocks_reserved_lte_stock', sql`${t.inReserved} <= ${t.inStock}`),
    check(
      'stocks_revision_safe',
      sql`${t.revision} >= 0 and ${t.revision} <= 9007199254740991`,
    ),
  ],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    orderId: uuid('order_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    productId: uuid('product_id').notNull(),

    quantity: integer('quantity').notNull(),
    status: reservationStatus('status').notNull().default('active'),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('reservations_quantity_positive', sql`${t.quantity} > 0`),

    // One reserve per order position.
    uniqueIndex('reservations_order_item').on(t.orderId, t.orderItemId),

    index('reservations_product_status').on(t.productId, t.status),
    index('reservations_expiry_active')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
  ],
);
