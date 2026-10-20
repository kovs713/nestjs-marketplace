import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  clampLimit,
  DomainError,
  nextCursor,
  pageKeyset,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  pgErrorConstraint,
  UniqueId,
  type DbClient,
  type DbTransaction,
  type PageInput,
} from '@app/common';

import {
  paymentHistory,
  paymentIdempotency,
  payments,
} from './database/payment.schema.js';
import { Payment } from './domain/payment.js';
import {
  type CreatePaymentProps,
  type Operation,
  type PaymentFilter,
  type PaymentState,
  type SavedPayment,
} from './domain/payment.types.js';
import { toPaymentState } from './mappers/payment.mapper.js';
import {
  fromPaymentRow,
  toPaymentDomain,
  toPaymentRow,
} from './mappers/payment.persistence-mapper.js';
import { toPaymentEvents } from './payment.events.js';

@Injectable()
export class PaymentRepository {
  constructor(
    @InjectDrizzle()
    private readonly db: NodePgDatabase,
    private readonly outbox: Outbox,
  ) {}

  create(input: CreatePaymentProps, key: string, hash: string) {
    return this.idempotentTransaction(
      'create',
      input.orderId.value,
      key,
      hash,
      async (tx, row) => {
        if (row) {
          const existing = toPaymentDomain(row);
          if (!existing.matches(input)) {
            throw new DomainError(
              'ALREADY_EXISTS',
              'payment already exists for order',
            );
          }

          return fromPaymentRow(row);
        }

        const payment = Payment.create(input, {
          id: UniqueId.create(),
          now: new Date(),
        });
        await this.saveWithHistoryAndOutbox(tx, payment, true);
        return toPaymentState(payment.state);
      },
    );
  }

  withPaymentTransaction(
    operation: Exclude<Operation, 'create'>,
    orderId: string,
    key: string,
    hash: string,
    execute: (payment: Payment, tx: DbTransaction) => Promise<void>,
  ) {
    return this.idempotentTransaction(
      operation,
      orderId,
      key,
      hash,
      async (tx, row) => {
        const payment = toPaymentDomain(this.required(row));

        await execute(payment, tx);

        return toPaymentState(payment.state);
      },
    );
  }

  private async idempotentTransaction(
    operation: Operation,
    orderId: string,
    key: string,
    hash: string,
    execute: (
      tx: DbTransaction,
      row: typeof payments.$inferSelect | undefined,
    ) => Promise<PaymentState>,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const saved = await this.idempotent(operation, key, tx);
          if (saved) return this.replay(saved, hash);
          const row = await this.orderRow(orderId, tx);
          const replay = await this.idempotent(operation, key, tx);
          if (replay) return this.replay(replay, hash);
          const response = await execute(tx, row);
          await this.saveIdempotency(tx, operation, key, hash, response);
          return response;
        });
      } catch (error) {
        const unique = pgErrorCode(error) === PG_UNIQUE_VIOLATION;
        const constraint = pgErrorConstraint(error);
        const orderConflict =
          unique &&
          operation === 'create' &&
          constraint === 'payments_order_id';
        const keyConflict =
          unique && constraint === 'payment_idempotency_operation_key';
        const guardFailure =
          error instanceof DomainError &&
          ['NOT_FOUND', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(
            error.code,
          );
        if (!orderConflict && !keyConflict && !guardFailure) throw error;

        // The failed transaction has rolled back; only committed results can replay.
        const saved = await this.idempotent(operation, key);
        if (saved) return this.replay(saved, hash);

        // Reload the winning order, validate matches(input), and save this key's result.
        if (orderConflict && attempt === 0) continue;
        throw error;
      }
    }
  }

  private replay(saved: SavedPayment, hash: string) {
    if (saved.requestHash !== hash) {
      throw new DomainError(
        'ALREADY_EXISTS',
        'idempotency key already used with a different request',
      );
    }

    return saved.response;
  }

  private required<T>(value: T | undefined): T {
    if (!value) {
      throw new DomainError('NOT_FOUND', 'payment not found');
    }

    return value;
  }

  private async saveIdempotency(
    tx: DbTransaction,
    operation: Operation,
    key: string,
    requestHash: string,
    response: PaymentState,
  ) {
    await tx.insert(paymentIdempotency).values({
      operation,
      idempotencyKey: key,
      requestHash,
      response: {
        ...response,
        createdAt: response.createdAt.getTime(),
        updatedAt: response.updatedAt.getTime(),
      },
    });
  }

  async byId(id: string) {
    return fromPaymentRow(
      this.required(
        (
          await this.db
            .select()
            .from(payments)
            .where(eq(payments.id, id))
            .limit(1)
        )[0],
      ),
    );
  }

  async byOrder(orderId: string) {
    return fromPaymentRow(this.required(await this.orderRow(orderId)));
  }

  private async orderRow(orderId: string, tx?: DbTransaction) {
    const query = (tx ?? this.db)
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .limit(1);

    const rows = await (tx ? query.for('update') : query);

    return rows[0];
  }

  async idempotent(
    operation: Operation,
    key: string,
    db: DbClient = this.db,
  ): Promise<SavedPayment | undefined> {
    const [saved] = await db
      .select()
      .from(paymentIdempotency)
      .where(
        and(
          eq(paymentIdempotency.operation, operation),
          eq(paymentIdempotency.idempotencyKey, key),
        ),
      )
      .limit(1);

    return (
      saved && {
        requestHash: saved.requestHash,
        response: {
          ...saved.response,
          createdAt: new Date(saved.response.createdAt),
          updatedAt: new Date(saved.response.updatedAt),
        },
      }
    );
  }

  async list(input: PaymentFilter) {
    const { limit, after } = pageKeyset({
      limit: input.page?.limit ?? 0,
      cursor: input.page?.cursor ?? '',
    });

    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          input.userId ? eq(payments.userId, input.userId) : undefined,
          input.orderId ? eq(payments.orderId, input.orderId) : undefined,
          input.statuses.length
            ? inArray(payments.status, input.statuses)
            : undefined,
          after ? gt(payments.id, after) : undefined,
        ),
      )
      .orderBy(asc(payments.id))
      .limit(limit);

    const items = rows.map(fromPaymentRow);

    return { items, nextCursor: nextCursor(items, limit) };
  }

  async history(paymentId: string, page?: PageInput) {
    const limit = clampLimit(page?.limit);
    const cursor = page?.cursor ?? '';
    const after = Number(cursor || 0);

    if (cursor && (!/^[1-9]\d*$/.test(cursor) || after > 2_147_483_647)) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        'invalid payment history cursor',
      );
    }

    const rows = await this.db
      .select()
      .from(paymentHistory)
      .where(
        and(
          eq(paymentHistory.paymentId, paymentId),
          after ? gt(paymentHistory.sequence, after) : undefined,
        ),
      )
      .orderBy(asc(paymentHistory.sequence))
      .limit(limit);

    return {
      items: rows,
      nextCursor:
        rows.length === limit ? String(rows[rows.length - 1].sequence) : '',
    };
  }

  async saveWithHistoryAndOutbox(
    tx: DbTransaction,
    payment: Payment,
    insert = false,
  ) {
    const p = toPaymentState(payment.state);
    await this.savePayment(tx, p, insert);
    await this.appendHistory(tx, p);

    for (const message of toPaymentEvents(p)) {
      await this.outbox.add<unknown>(tx, message);
    }
  }

  private async savePayment(
    tx: DbTransaction,
    p: PaymentState,
    insert: boolean,
  ) {
    const value = toPaymentRow(p);

    if (insert) {
      await tx.insert(payments).values(value);
    } else {
      const [updated] = await tx
        .update(payments)
        .set({
          status: p.status,
          providerRef: value.providerRef,
          provider: p.provider,
          refundProviderRef: value.refundProviderRef,
          failureCode: value.failureCode,
          failureMessage: value.failureMessage,
          updatedAt: p.updatedAt,
        })
        .where(eq(payments.id, p.id))
        .returning({ id: payments.id });

      if (!updated) {
        throw new DomainError('NOT_FOUND', 'payment not found');
      }
    }
  }

  private async appendHistory(tx: DbTransaction, p: PaymentState) {
    const [last] = await tx
      .select({
        sequence: sql<number>`coalesce(max(${paymentHistory.sequence}), 0)`,
      })
      .from(paymentHistory)
      .where(eq(paymentHistory.paymentId, p.id));

    await tx.insert(paymentHistory).values({
      paymentId: p.id,
      sequence: last.sequence + 1,
      status: p.status,
      providerResponse: {
        provider: p.provider,
        failure_code: p.failureCode,
        provider_ref: p.providerRef,
        refund_provider_ref: p.refundProviderRef,
      },
    });
  }
}
