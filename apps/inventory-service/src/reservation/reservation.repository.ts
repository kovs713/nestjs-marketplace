import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  clampLimit,
  DomainError,
  type DbClient,
  type DbTransaction,
} from '@app/common';

import {
  reservationOrders,
  reservations,
  reserveIdempotency,
  stocks,
  type NewReservation,
  type Reservation,
  type Stock,
} from '../database/inventory.schema.js';
import {
  restoreReservations,
  storeReservations,
} from './reservation.snapshot.js';
import type {
  ReservationOperation,
  ReservationState,
} from './reservation.types.js';

@Injectable()
export class ReservationRepository {
  constructor(
    @InjectDrizzle()
    private readonly db: NodePgDatabase,
  ) {}

  // Operation idempotency

  async replayResult(
    tx: DbTransaction,
    operation: ReservationOperation,
    key: string,
    hash: string,
  ): Promise<ReservationState[] | null> {
    const row = await this.findResult(operation, key, tx);

    if (!row) {
      return null;
    }

    if (row.requestHash !== hash) {
      throw new DomainError(
        'ALREADY_EXISTS',
        'idempotency key used with a different request',
      );
    }

    return restoreReservations(row.response);
  }

  async findResult(
    operation: ReservationOperation,
    key: string,
    db: DbClient = this.db,
  ) {
    const [row] = await db
      .select()
      .from(reserveIdempotency)
      .where(
        and(
          eq(reserveIdempotency.key, key),
          eq(reserveIdempotency.operation, operation),
        ),
      );

    return row;
  }

  async saveResult(
    tx: DbTransaction,
    operation: ReservationOperation,
    key: string,
    requestHash: string,
    response: ReservationState[],
  ): Promise<void> {
    await tx.insert(reserveIdempotency).values({
      key,
      requestHash,
      operation,
      response: storeReservations(response),
    });
  }

  // Reservation locks and transitions

  /** Locks the order, then its holds. Always follows replayResult. */
  async lockOrderReservations(
    db: DbTransaction,
    orderId: string,
  ): Promise<Reservation[]> {
    await db
      .insert(reservationOrders)
      .values({ orderId })
      .onConflictDoNothing();
    await db
      .select()
      .from(reservationOrders)
      .where(eq(reservationOrders.orderId, orderId))
      .for('update');
    return this.reservationsByOrder(db, orderId);
  }

  private reservationsByOrder(
    db: DbTransaction,
    orderId: string,
  ): Promise<Reservation[]> {
    return db
      .select()
      .from(reservations)
      .where(eq(reservations.orderId, orderId))
      .orderBy(asc(reservations.expiresAt), asc(reservations.id))
      .for('update');
  }

  insertReservations(
    db: DbTransaction,
    values: NewReservation[],
  ): Promise<Reservation[]> {
    return db.insert(reservations).values(values).returning();
  }

  async finalizeReservations(
    db: DbTransaction,
    orderId: string,
    to: 'committed' | 'released',
  ): Promise<{ reservations: Reservation[]; changedStocks: Stock[] }> {
    const writeOff =
      to === 'committed'
        ? sql`in_stock = in_stock - a.quantity, in_reserved = in_reserved - a.quantity`
        : sql`in_reserved = in_reserved - a.quantity`;

    const { rows } = await db.execute<Stock>(sql`
      with active as (
        update reservations
        set status = ${to}, updated_at = now()
        where order_id = ${orderId}::uuid and status = 'active'
          ${to === 'committed' ? sql`and expires_at > clock_timestamp()` : sql``}
        returning product_id, quantity
      ), totals as (
        select product_id, sum(quantity)::integer as quantity from active group by product_id
      )
      update stocks s
      set ${writeOff}, revision = s.revision + 1, updated_at = now()
      from totals a
      where s.product_id = a.product_id
      returning
        s.product_id as "productId",
        s.in_stock as "inStock",
        s.in_reserved as "inReserved",
        s.revision::double precision as "revision",
        s.updated_at as "updatedAt"
    `);
    return {
      reservations: await this.reservationsByOrder(db, orderId),
      changedStocks: rows,
    };
  }

  // Expiry waits for in-flight finalizers; a failed commit must not leave its
  // locked, expired hold un-released by a skipped expiry pass.

  async expireReservations(db: DbTransaction) {
    const limit = clampLimit();

    const expired = db.$with('expired').as(
      db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.status, 'active'),
            lte(reservations.expiresAt, sql`now()`),
          ),
        )
        .orderBy(asc(reservations.expiresAt), asc(reservations.id))
        .limit(limit)
        .for('update'),
    );

    const released = db.$with('released').as(
      db
        .update(reservations)
        .set({
          status: 'expired',
          updatedAt: sql`now()`,
        })
        .from(expired)
        .where(eq(reservations.id, expired.id))
        .returning({
          productId: reservations.productId,
          quantity: reservations.quantity,
        }),
    );

    const totals = db.$with('totals').as(
      db
        .select({
          productId: released.productId,
          quantity: sql<number>`
          sum(${released.quantity})::integer
        `.as('quantity'),
        })
        .from(released)
        .groupBy(released.productId),
    );

    // then single atomic sql statement
    return db
      .with(expired, released, totals)
      .update(stocks)
      .set({
        inReserved: sql`${stocks.inReserved} - ${totals.quantity}`,
        revision: sql`${stocks.revision} + 1`,
        updatedAt: sql`now()`,
      })
      .from(totals)
      .where(eq(stocks.productId, totals.productId))
      .returning();
  }
}
