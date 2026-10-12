import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  DbClient,
  DbTransaction,
  PageInput as PageRequest,
} from '@app/common';
import {
  DomainError,
  Money,
  nextCursor,
  pageKeyset,
  StockQuantity,
  translate,
  UniqueId,
} from '@app/common';

import type { ProductFilter, ProductView } from '../application/catalog.dto.js';
import { toProductState } from '../application/product.mapper.js';
import { Product as DomainProduct } from '../domain/product.js';
import {
  categories,
  productCategories,
  type Category,
} from './database/categories.schema.js';
import { products, type Product } from './database/products.schema.js';
import {
  stockProjection,
  type StockProjection,
} from './database/stock.schema.js';

@Injectable()
export class CatalogRepository {
  constructor(
    @InjectDrizzle()
    private readonly db: NodePgDatabase,
  ) {}

  async transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(fn);
    } catch (error) {
      return translate(error);
    }
  }

  // Queries

  async getProduct(id: string, includeDeleted = false) {
    const row = await this.findProductById(id, includeDeleted);
    return row ? (await this.loadProductViews([row]))[0] : undefined;
  }

  async products(f: ProductFilter) {
    const { limit, after } = pageKeyset(f.page);

    const filters = [
      f.sellerId ? eq(products.sellerId, f.sellerId) : undefined,
      f.categoryId
        ? inArray(
            products.id,
            this.db
              .select({ productId: productCategories.productId })
              .from(productCategories)
              .where(eq(productCategories.categoryId, f.categoryId)),
          )
        : undefined,
      f.titleContains
        ? ilike(products.title, `%${f.titleContains}%`)
        : undefined,
      isNull(products.deletedAt),
      after ? sql`${products.id} > ${after}::uuid` : undefined,
    ].filter(Boolean) as SQL[];

    const rows = await this.db
      .select()
      .from(products)
      .where(and(...filters))
      .orderBy(asc(products.id))
      .limit(limit);

    return {
      items: await this.loadProductViews(rows),
      nextCursor: nextCursor(rows, limit),
    };
  }

  async productByKey(sellerId: string, idempotencyKey: string) {
    const [row] = await this.db
      .select()
      .from(products)
      .where(
        and(
          eq(products.sellerId, sellerId),
          eq(products.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (!row) return undefined;

    const categories = await this.categoryIdsFor([row.id]);
    return { ...row, categoryIds: categories.get(row.id) ?? [] };
  }

  async categoryById(id: string): Promise<Category | undefined> {
    const [row] = await this.db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);

    return row;
  }

  async categories(f: { page?: PageRequest; parentId?: string }) {
    const { limit, after } = pageKeyset(f.page);

    const filters = [
      f.parentId ? eq(categories.parentId, f.parentId) : undefined,
      after ? sql`${categories.id} > ${after}::uuid` : undefined,
    ].filter(Boolean) as SQL[];

    const rows = await this.db
      .select()
      .from(categories)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(categories.id))
      .limit(limit);

    return { items: rows, nextCursor: nextCursor(rows, limit) };
  }

  // Commands

  async insertProduct(db: DbClient, product: DomainProduct): Promise<void> {
    const { categoryIds: _, ...state } = toProductState(product);

    await db.insert(products).values(state);
  }

  async loadProductForUpdate(
    tx: DbTransaction,
    id: string,
  ): Promise<DomainProduct> {
    const row = await this.findProductById(id, false, tx, true);
    if (!row) throw new DomainError('NOT_FOUND', 'product not found');

    const categories = await this.categoryIdsFor([id], tx);
    const { id: productId, sellerId, priceMinor, ...state } = row;

    return DomainProduct.reconstitute({
      ...state,
      id: UniqueId.from(productId),
      sellerId: UniqueId.from(sellerId),
      price: Money.fromMinor(priceMinor),
      categoryIds: (categories.get(id) ?? []).map((category) =>
        UniqueId.from(category),
      ),
    });
  }

  async updateProduct(db: DbClient, product: DomainProduct): Promise<void> {
    const { categoryIds: _, ...state } = toProductState(product);

    const [updated] = await db
      .update(products)
      .set(state)
      .where(
        and(
          eq(products.id, state.id),
          eq(products.sellerId, state.sellerId),
          isNull(products.deletedAt),
        ),
      )
      .returning({ id: products.id });

    if (!updated) {
      throw new DomainError('NOT_FOUND', 'product not found');
    }
  }

  async replaceProductCategories(
    productId: string,
    categoryIds: string[],
    db: DbClient,
  ): Promise<void> {
    await db
      .delete(productCategories)
      .where(eq(productCategories.productId, productId));

    if (categoryIds.length) {
      await db
        .insert(productCategories)
        .values(categoryIds.map((categoryId) => ({ productId, categoryId })));
    }
  }

  async upsertStockProjection(
    tx: DbClient,
    productId: string,
    inStock: number,
    inReserved: number,
    revision: number,
  ): Promise<void> {
    StockQuantity.from(inStock);
    StockQuantity.from(inReserved);

    await tx
      .insert(stockProjection)
      .values({
        productId,
        inStock,
        inReserved,
        revision,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: stockProjection.productId,
        set: {
          inStock: sql`excluded.in_stock`,
          inReserved: sql`excluded.in_reserved`,
          revision: sql`excluded.revision`,
          syncedAt: sql`excluded.synced_at`,
        },
        setWhere: sql`excluded.revision > ${stockProjection.revision}`,
      });
  }

  // Helpers

  private async findProductById(
    id: string,
    includeDeleted = false,
    db: DbClient = this.db,
    lock = false,
  ): Promise<Product | undefined> {
    const query = db
      .select()
      .from(products)
      .where(
        includeDeleted
          ? eq(products.id, id)
          : and(eq(products.id, id), isNull(products.deletedAt)),
      )
      .limit(1);

    return (lock ? query.for('update') : query).then((rows) => rows[0]);
  }

  private async loadProductViews(rows: Product[]): Promise<ProductView[]> {
    const ids = rows.map((row) => row.id);

    const [categories, stocks] = await Promise.all([
      this.categoryIdsFor(ids),
      this.stockFor(ids),
    ]);

    return rows.map((row) => ({
      ...row,
      categoryIds: categories.get(row.id) ?? [],
      stock: stocks.get(row.id),
    }));
  }

  async categoryIdsFor(
    productIds: string[],
    db: DbClient = this.db,
  ): Promise<Map<string, string[]>> {
    if (!productIds.length) return new Map();

    const rows = await db
      .select()
      .from(productCategories)
      .where(inArray(productCategories.productId, productIds));

    const map = new Map<string, string[]>();

    for (const row of rows) {
      const list = map.get(row.productId) ?? [];
      list.push(row.categoryId);
      map.set(row.productId, list);
    }

    return map;
  }

  async stockFor(
    productIds: string[],
    db: DbClient = this.db,
  ): Promise<Map<string, StockProjection>> {
    if (!productIds.length) return new Map();

    const rows = await db
      .select()
      .from(stockProjection)
      .where(inArray(stockProjection.productId, productIds));

    return new Map(rows.map((row) => [row.productId, row]));
  }
}
