import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { PaymentState } from '../domain/payment.types.js';
import { PAYMENT_STATUSES } from '../domain/payment.types.js';

type PaymentSnapshot = Omit<PaymentState, 'createdAt' | 'updatedAt'> & {
  createdAt: number;
  updatedAt: number;
};

export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentMethod = pgEnum('payment_method', [
  'CARD',
  'SBP',
  'WALLET',
]);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    orderId: uuid('order_id').notNull(),
    userId: uuid('user_id').notNull(),

    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    method: paymentMethod('method').notNull(),
    status: paymentStatus('status').notNull().default('PENDING'),
    provider: text('provider').notNull().default('mock'),
    providerRef: text('provider_ref'),
    refundProviderRef: text('refund_provider_ref'),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('payments_amount_minor_positive', sql`${t.amountMinor} > 0`),

    uniqueIndex('payments_order_id').on(t.orderId),
  ],
);

export const paymentHistory = pgTable(
  'payment_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),

    sequence: integer('sequence').notNull(),
    status: paymentStatus('status').notNull(),
    providerResponse: jsonb('provider_response'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('payment_history_sequence_positive', sql`${t.sequence} > 0`),

    uniqueIndex('payment_history_payment_sequence').on(t.paymentId, t.sequence),
  ],
);

export const paymentIdempotency = pgTable(
  'payment_idempotency',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    operation: text('operation').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').$type<PaymentSnapshot>().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_idempotency_operation_key').on(
      t.operation,
      t.idempotencyKey,
    ),
  ],
);
