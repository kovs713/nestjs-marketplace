import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import { and, asc, eq, getColumns, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  DomainError,
  nextCursor,
  pageKeyset,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  pgErrorConstraint,
  type DbClient,
  type Page,
  type PageInput,
} from '@app/common';
import {
  CHECKOUT_REQUESTED,
  EVENT_SCHEMA_VERSION,
  NOTIFICATION_REQUESTED,
  TOPICS,
} from '@app/contracts';

import { orderItems } from './database/order-items.schema.js';
import { checkoutIdempotency, orders } from './database/orders.schema.js';
import type { Order, OrderStatus } from './domain/order.js';
import { fromOrderSnapshot, toOrderSnapshot } from './domain/order.snapshot.js';
import type { OrderItemView, OrderView } from './domain/order.types.js';
import { toOrderView } from './mappers/order.mapper.js';
import {
  toOrderDomain,
  type OrderRecord,
} from './mappers/order.persistence-mapper.js';
import type { OrderStore } from './ports.js';

// Recovery scheduling is infrastructure metadata, not order state.
const { recoveryAttemptedAt: _recoveryAttemptedAt, ...orderColumns } =
  getColumns(orders);

const {
  captureIntentRecorded: _captureIntentRecorded,
  compensationPending: _compensationPending,
  paymentTimeoutAt: _paymentTimeoutAt,
  ...viewColumns
} = orderColumns;

const ORDER_NOTIFICATIONS: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'Order placed',
  PAID: 'Payment received',
  CONFIRMED: 'Order confirmed',
  CANCELED: 'Order canceled',
  FAILED: 'Order failed',
};

@Injectable()
export class OrderRepository implements OrderStore {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly outbox: Outbox,
  ) {}

  // Checkout acceptance and idempotent replay

  async checkout(
    userId: string,
    key: string,
    build: Parameters<OrderStore['checkout']>[2],
  ): Promise<OrderView> {
    const replay = await this.checkoutReplay(this.db, userId, key);

    if (replay) {
      return replay;
    }

    const draft = await this.cartIn(this.db, userId, false);

    if (!draft || !draft.items.length) {
      throw new DomainError('FAILED_PRECONDITION', 'cart is empty');
    }

    // No transaction/connection is held while Catalog fixes the prices.
    const aggregate = await build(toOrderDomain(draft));
    const state = aggregate.state;

    const view = toOrderView(state);
    const { items, createdAt: _createdAt, ...fields } = view;

    const row = {
      ...fields,
      captureIntentRecorded: state.captureIntentRecorded,
      compensationPending: state.compensationPending,
      paymentTimeoutAt: state.paymentTimeoutAt,
    };

    if (row.id !== draft.id || row.userId !== userId) {
      throw new DomainError('INTERNAL', 'checkout must consume its cart');
    }

    return this.db
      .transaction(async (tx) => {
        const current = await this.cartIn(tx, userId);
        // Recheck after the lock: another checkout may have accepted this key.
        const accepted = await this.checkoutReplay(tx, userId, key);

        if (accepted) {
          return accepted;
        }

        // Cart writers lock the parent; only identity and composition matter here.
        if (
          current?.id !== draft.id ||
          current.items.length !== draft.items.length ||
          current.items.some((item, index) => {
            const before = draft.items[index]!;
            return (
              item.id !== before.id ||
              item.productId !== before.productId ||
              item.quantity !== before.quantity
            );
          })
        ) {
          throw new DomainError(
            'FAILED_PRECONDITION',
            'cart changed during pricing; retry checkout',
          );
        }

        const changed = await tx
          .update(orders)
          .set(row)
          .where(
            and(
              eq(orders.id, draft.id),
              eq(orders.userId, userId),
              eq(orders.status, 'DRAFT'),
            ),
          )
          .returning({ id: orders.id });

        if (!changed.length) {
          throw new DomainError(
            'FAILED_PRECONDITION',
            'cart changed concurrently',
          );
        }

        for (const item of items) {
          const { id, orderId, createdAt: _createdAt, ...snapshot } = item;

          const updated = await tx
            .update(orderItems)
            .set(snapshot)
            .where(and(eq(orderItems.id, id), eq(orderItems.orderId, draft.id)))
            .returning({ id: orderItems.id });

          if (orderId !== draft.id || !updated.length) {
            throw new DomainError(
              'INTERNAL',
              'checkout must preserve its cart items',
            );
          }
        }

        // Acceptance is the PENDING_PAYMENT transition; notify in the same commit.
        await this.notify(tx, view);
        await this.outbox.add(tx, {
          topic: TOPICS.order,
          key: view.id,
          headers: {
            event_type: CHECKOUT_REQUESTED,
            schema_version: EVENT_SCHEMA_VERSION,
            correlation_id: view.id,
          },
          payload: { order_id: view.id },
        });

        // Acceptance snapshot and state share the same commit.
        await tx.insert(checkoutIdempotency).values({
          userId,
          key,
          response: toOrderSnapshot(aggregate),
        });

        return view;
      })
      .catch(async (error: unknown) => {
        // The losing acceptance must roll back before reading the winner's snapshot.
        if (
          pgErrorCode(error) === PG_UNIQUE_VIOLATION &&
          pgErrorConstraint(error) === 'checkout_idempotency_user_key'
        ) {
          const replay = await this.checkoutReplay(this.db, userId, key);

          if (replay) {
            return replay;
          }
        }

        throw error;
      });
  }

  private async checkoutReplay(
    tx: DbClient,
    userId: string,
    key: string,
  ): Promise<OrderView | undefined> {
    const [saved] = await tx
      .select()
      .from(checkoutIdempotency)
      .where(
        and(
          eq(checkoutIdempotency.userId, userId),
          eq(checkoutIdempotency.key, key),
        ),
      );

    return saved ? fromOrderSnapshot(saved.response) : undefined;
  }

  // Order persistence and notifications

  async load(id: string): Promise<Order> {
    const [row] = await this.db
      .select(orderColumns)
      .from(orders)
      .where(eq(orders.id, id));

    if (!row) {
      throw new DomainError('NOT_FOUND', 'order not found');
    }

    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));

    return toOrderDomain({ ...row, items });
  }

  async save(order: Order, expected: OrderStatus): Promise<void> {
    const state = order.state;
    const row = { ...state, id: state.id.value, userId: state.userId.value };

    if (row.status === expected) {
      throw new DomainError('FAILED_PRECONDITION', 'order status must change');
    }

    await this.db.transaction(async (tx) => {
      const changed = await tx
        .update(orders)
        .set({
          status: row.status,
          failureReason: row.failureReason,
          compensationPending: row.compensationPending,
          updatedAt: row.updatedAt,
        })
        .where(and(eq(orders.id, row.id), eq(orders.status, expected)))
        .returning({ id: orders.id });

      if (!changed.length) {
        throw new DomainError(
          'FAILED_PRECONDITION',
          'order changed concurrently',
        );
      }

      await this.notify(tx, row);
    });
  }

  async list(
    userId: string,
    statuses: OrderStatus[],
    page?: PageInput,
  ): Promise<Page<OrderView>> {
    const { limit, after } = pageKeyset(
      page ? { limit: page.limit ?? 0, cursor: page.cursor ?? '' } : undefined,
    );

    const rows = await this.db
      .select(viewColumns)
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          statuses.length ? inArray(orders.status, statuses) : undefined,
          after ? sql`${orders.id} > ${after}::uuid` : undefined,
        ),
      )
      .orderBy(asc(orders.id))
      .limit(limit);

    const byOrder = new Map<string, OrderItemView[]>(
      rows.map((row) => [row.id, []]),
    );

    if (rows.length) {
      const allItems = await this.db
        .select()
        .from(orderItems)
        .where(
          inArray(
            orderItems.orderId,
            rows.map((row) => row.id),
          ),
        );

      for (const item of allItems) {
        byOrder.get(item.orderId)!.push(item);
      }
    }

    const items = rows.map((row) => ({ ...row, items: byOrder.get(row.id)! }));

    return { items, nextCursor: nextCursor(rows, limit) };
  }

  private async notify(
    tx: DbClient,
    order: Pick<OrderView, 'id' | 'userId' | 'status' | 'failureReason'>,
  ): Promise<void> {
    const title = ORDER_NOTIFICATIONS[order.status];

    if (!title) {
      return;
    }

    await this.outbox.add(tx, {
      topic: TOPICS.notification,
      key: order.id,
      headers: {
        event_type: NOTIFICATION_REQUESTED,
        schema_version: EVENT_SCHEMA_VERSION,
        correlation_id: order.id,
      },
      payload: {
        user_id: order.userId,
        order_id: order.id,
        type: 'ORDER_STATUS',
        title,
        body: (order.failureReason ?? title).slice(0, 2000),
        payload: {
          status: order.status,
          ...(order.failureReason
            ? { failure_reason: order.failureReason }
            : {}),
        },
      },
    });
  }

  // Saga checkpoints

  async recordCaptureIntent(id: string): Promise<void> {
    const changed = await this.db
      .update(orders)
      .set({ captureIntentRecorded: true })
      .where(and(eq(orders.id, id), eq(orders.status, 'PENDING_PAYMENT')))
      .returning({ id: orders.id });

    if (!changed.length) {
      throw new DomainError('FAILED_PRECONDITION', 'order no longer pending');
    }
  }

  async compensationDone(id: string): Promise<void> {
    await this.db
      .update(orders)
      .set({ compensationPending: false })
      .where(
        and(eq(orders.id, id), inArray(orders.status, ['FAILED', 'CANCELED'])),
      );
  }

  // Recovery scheduling

  async recoverableIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        sql`${orders.status} in ('PENDING_PAYMENT', 'PAID') or ${orders.compensationPending}`,
      )
      .orderBy(
        sql`${orders.recoveryAttemptedAt} asc nulls first`,
        asc(orders.updatedAt),
      )
      .limit(50);

    return rows.map((row) => row.id);
  }

  async recoveryAttempted(id: string): Promise<void> {
    await this.db
      .update(orders)
      .set({ recoveryAttemptedAt: new Date() })
      .where(eq(orders.id, id));
  }

  // Cart persistence

  cart(userId: string): Promise<OrderView | undefined> {
    return this.db.transaction(async (tx) => {
      const cart = await this.cartIn(tx, userId);

      if (!cart) {
        return undefined;
      }

      const {
        captureIntentRecorded: _intent,
        compensationPending: _pending,
        paymentTimeoutAt: _timeout,
        ...view
      } = cart;

      return view;
    });
  }

  async mutateCart(
    userId: string,
    mutate: Parameters<OrderStore['mutateCart']>[1],
  ): Promise<void> {
    for (;;) {
      try {
        await this.db.transaction(async (tx) => {
          let cart = await this.cartIn(tx, userId);

          if (!cart) {
            const [row] = await tx
              .insert(orders)
              .values({ userId, status: 'DRAFT' })
              .returning(orderColumns);

            cart = { ...row!, items: [] };
          }

          // Parent row lock serializes cancellation with guarded cart writes.
          const aggregate = toOrderDomain(cart);

          mutate(aggregate);

          const view = toOrderView(aggregate.state);
          const remaining = new Set(view.items.map((item) => item.id));
          const removed = cart.items
            .filter((item) => !remaining.has(item.id))
            .map((item) => item.id);

          if (removed.length) {
            await tx
              .delete(orderItems)
              .where(
                and(
                  eq(orderItems.orderId, cart.id),
                  inArray(orderItems.id, removed),
                ),
              );
          }

          const original = new Map(cart.items.map((item) => [item.id, item]));

          for (const item of view.items) {
            const before = original.get(item.id);

            if (!before) {
              await tx.insert(orderItems).values(item);
            } else if (before.quantity !== item.quantity) {
              await tx
                .update(orderItems)
                .set({ quantity: item.quantity })
                .where(
                  and(
                    eq(orderItems.id, item.id),
                    eq(orderItems.orderId, cart.id),
                  ),
                );
            }
          }

          await tx
            .update(orders)
            .set({ updatedAt: view.updatedAt })
            .where(eq(orders.id, cart.id));
        });

        return;
      } catch (error) {
        // Two first adds can both see no cart. Retry from fresh committed state.
        if (
          pgErrorCode(error) !== PG_UNIQUE_VIOLATION ||
          pgErrorConstraint(error) !== 'orders_user_draft'
        ) {
          throw error;
        }
      }
    }
  }

  private async cartIn(
    tx: DbClient,
    userId: string,
    lock = true,
  ): Promise<OrderRecord | undefined> {
    for (;;) {
      const [candidate] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.userId, userId), eq(orders.status, 'DRAFT')))
        .limit(1);

      if (!candidate) {
        return undefined;
      }

      const query = tx
        .select(orderColumns)
        .from(orders)
        .where(eq(orders.id, candidate.id));
      const [row] = await (lock ? query.for('update') : query);

      // Acceptance/cancellation may have replaced the draft while we waited.
      if (!row || row.status !== 'DRAFT') {
        continue;
      }

      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, row.id))
        .orderBy(asc(orderItems.id));

      return { ...row, items };
    }
  }
}
