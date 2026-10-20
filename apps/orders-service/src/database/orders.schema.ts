import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { OrderSnapshot } from '../domain/order.snapshot.js';

export const orderStatus = pgEnum('order_status', [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'CANCELED',
  'FAILED',
]);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export const orders = pgTable(
  'orders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id').notNull(), // users-service users.id, no FK

    status: orderStatus('status').notNull().default('DRAFT'),
    // NULL in DRAFT: the total is only fixed at checkout.
    totalMinor: bigint('total_minor', { mode: 'number' }),
    failureReason: text('failure_reason'),
    paymentTimeoutAt: timestamp('payment_timeout_at', { withTimezone: true }),
    captureIntentRecorded: boolean('capture_intent_recorded')
      .notNull()
      .default(false),
    compensationPending: boolean('compensation_pending')
      .notNull()
      .default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    recoveryAttemptedAt: timestamp('recovery_attempted_at', {
      withTimezone: true,
    }),
  },
  (t) => [
    check(
      'orders_total_minor_nonneg',
      sql`${t.totalMinor} is null or ${t.totalMinor} >= 0`,
    ),
    index('orders_user_status').on(t.userId, t.status),
    // One active cart per user.
    uniqueIndex('orders_user_draft')
      .on(t.userId)
      .where(sql`${t.status} = 'DRAFT'`),
    index('orders_pending_payment')
      .on(t.status)
      .where(sql`${t.status} = 'PENDING_PAYMENT'`),
  ],
);

export const checkoutIdempotency = pgTable(
  'checkout_idempotency',
  {
    userId: uuid('user_id').notNull(),
    key: text('key').notNull(),
    response: jsonb('response').$type<OrderSnapshot>().notNull(),
  },
  (t) => [uniqueIndex('checkout_idempotency_user_key').on(t.userId, t.key)],
);
