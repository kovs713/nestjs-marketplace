import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { Page, PageInput } from '@app/common';
import {
  DomainError,
  encodeCursor,
  pageKeyset,
  translate,
  type DbClient,
  type DbTransaction,
} from '@app/common';

import { stocks, type Stock } from '../database/inventory.schema.js';
import type { ReservationItem } from '../reservation/reservation.types.js';
import { toOutbox } from './stock.events.js';

@Injectable()
export class StockRepository {
  constructor(
    @InjectDrizzle()
    private readonly db: NodePgDatabase,
    private readonly outbox: Outbox,
  ) {}

  async transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(fn);
    } catch (error) {
      return translate(error);
    }
  }

  async recordStockInitialized(tx: DbTransaction, stock: Stock): Promise<void> {
    await this.outbox.add(tx, toOutbox(stock, 'stock.initialized'));
  }

  async recordStockChanges(tx: DbTransaction, stocks: Stock[]): Promise<void> {
    for (const stock of stocks)
      await this.outbox.add(tx, toOutbox(stock, 'stock.changed'));
  }

  async stockById(
    productId: string,
    db: DbClient = this.db,
  ): Promise<Stock | undefined> {
    const [row] = await db
      .select()
      .from(stocks)
      .where(eq(stocks.productId, productId))
      .limit(1);

    return row;
  }

  async listStocks(f: {
    page?: PageInput;
    productIds?: string[];
  }): Promise<Page<Stock>> {
    const { limit, after } = pageKeyset({
      limit: f.page?.limit ?? 0,
      cursor: f.page?.cursor ?? '',
    });

    const rows = await this.db
      .select()
      .from(stocks)
      .where(
        and(
          f.productIds?.length
            ? inArray(stocks.productId, f.productIds)
            : undefined,
          after ? sql`${stocks.productId} > ${after}::uuid` : undefined,
        ),
      )
      .orderBy(asc(stocks.productId))
      .limit(limit);

    return {
      items: rows,
      nextCursor:
        rows.length < limit
          ? ''
          : encodeCursor(rows[rows.length - 1].productId),
    };
  }

  // Guarded stock writes (never persist a loaded balance)

  async reserveItems(
    tx: DbTransaction,
    items: ReservationItem[],
  ): Promise<Stock[]> {
    const changed = new Map<string, Stock>();
    const sorted = [...items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );

    // Acquire stock locks in a consistent order to reduce deadlocks.
    for (const item of sorted) {
      const [stock] = await this.reserveStock(
        tx,
        item.productId,
        item.quantity,
      );

      if (!stock) {
        throw new DomainError(
          'FAILED_PRECONDITION',
          `insufficient stock for product ${item.productId}`,
        );
      }

      // Positions can share a product. Only publish its final transactional balance.
      changed.set(stock.productId, stock);
    }

    return [...changed.values()];
  }

  upsertStock(
    db: DbTransaction,
    productId: string,
    inStock: number,
  ): Promise<Stock[]> {
    return db
      .insert(stocks)
      .values({ productId, inStock })
      .onConflictDoUpdate({
        target: stocks.productId,
        set: {
          inStock,
          revision: sql`${stocks.revision} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  insertStock(
    db: DbTransaction,
    productId: string,
    inStock: number,
  ): Promise<Stock[]> {
    return db
      .insert(stocks)
      .values({ productId, inStock })
      .onConflictDoNothing()
      .returning();
  }

  /** Atomic single statement: SELECT-then-UPDATE would lose concurrent writes. */
  incrementStock(
    db: DbTransaction,
    productId: string,
    delta: number,
  ): Promise<Stock[]> {
    if (delta < 0) {
      return db
        .update(stocks)
        .set({
          inStock: sql`${stocks.inStock} + ${delta}`,
          revision: sql`${stocks.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stocks.productId, productId),
            sql`${stocks.inStock} + ${delta} >= ${stocks.inReserved}`,
          ),
        )
        .returning();
    }

    return db
      .insert(stocks)
      .values({ productId, inStock: delta })
      .onConflictDoUpdate({
        target: stocks.productId,
        set: {
          inStock: sql`${stocks.inStock} + ${delta}`,
          revision: sql`${stocks.revision} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  private reserveStock(
    db: DbTransaction,
    productId: string,
    quantity: number,
  ): Promise<Stock[]> {
    return db
      .update(stocks)
      .set({
        inReserved: sql`${stocks.inReserved} + ${quantity}`,
        revision: sql`${stocks.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stocks.productId, productId),
          sql`${stocks.inStock} - ${stocks.inReserved} >= ${quantity}`,
        ),
      )
      .returning();
  }
}
