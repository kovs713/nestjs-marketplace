import { Injectable, Logger } from '@nestjs/common';
import { Outbox } from '@nestjs/outbox';
import { createHash } from 'node:crypto';

import { Money, StockQuantity, UniqueId } from '@app/common';
import type { Actor } from '@app/common/application/actor.js';
import { DomainError } from '@app/common/errors/domain-error.js';
import { EVENT_SCHEMA_VERSION, PRODUCT_CREATED, TOPICS } from '@app/contracts';

import { Product } from '../domain/product.js';
import { CatalogRepository } from '../infrastructure/catalog.repository.js';
import type { ProductState, ProductUpdate } from './product.dto.js';
import { toProductPatch, toProductState } from './product.mapper.js';

export type CreateProduct = {
  title: string;
  description: string;
  priceMinor: number;
  imageUrl: string;
  categoryIds: string[];
  initialStock: number;
  idempotencyKey: string;
};

export const requestHash = (req: CreateProduct): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        req.title,
        req.description,
        req.priceMinor,
        req.imageUrl,
        [...(req.categoryIds ?? [])].sort(),
        req.initialStock,
      ]),
    )
    .digest('hex');

@Injectable()
export class CatalogCommands {
  private readonly logger = new Logger(CatalogCommands.name);

  constructor(
    private readonly repository: CatalogRepository,
    private readonly outbox: Outbox,
  ) {}

  async createProduct(actor: Actor, req: CreateProduct): Promise<ProductState> {
    const hash = requestHash(req);

    try {
      return await this.repository.transaction(async (tx) => {
        const now = new Date();

        const product = Product.create({
          id: UniqueId.create(),
          sellerId: UniqueId.from(actor.id),

          categoryIds: (req.categoryIds ?? []).map((id) => UniqueId.from(id)),

          title: req.title,
          description: req.description,
          price: Money.fromMinor(req.priceMinor),
          imageUrl: req.imageUrl || null,

          idempotencyKey: req.idempotencyKey,
          requestHash: hash,

          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });

        const initialStock = StockQuantity.from(req.initialStock);
        const state = toProductState(product);

        await this.repository.insertProduct(tx, product);
        await this.repository.replaceProductCategories(
          state.id,
          state.categoryIds,
          tx,
        );

        await this.outbox.add(tx, {
          topic: TOPICS.product,
          key: state.id,
          headers: {
            event_type: PRODUCT_CREATED,
            schema_version: EVENT_SCHEMA_VERSION,
            correlation_id: state.id,
          },
          payload: {
            product_id: state.id,
            seller_id: state.sellerId,
            initial_stock: initialStock.value,
          },
        });

        this.logger.log({
          msg: 'product created',
          productId: state.id,
          sellerId: state.sellerId,
          initialStock: initialStock.value,
        });

        return state;
      });
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === 'ALREADY_EXISTS' &&
        req.idempotencyKey
      ) {
        const current = await this.repository.productByKey(
          actor.id,
          req.idempotencyKey,
        );

        if (current?.requestHash === hash) {
          this.logger.debug({
            msg: 'product create replayed',
            productId: current.id,
            sellerId: actor.id,
          });

          return current;
        }

        throw new DomainError(
          'ALREADY_EXISTS',
          'idempotency key already used with a different request',
        );
      }

      throw error;
    }
  }

  async updateProduct(
    actor: Actor,
    id: string,
    patch: ProductUpdate,
  ): Promise<ProductState> {
    return this.repository.transaction(async (tx) => {
      const product = await this.repository.loadProductForUpdate(tx, id);

      product.update(UniqueId.from(actor.id), toProductPatch(patch));
      await this.repository.updateProduct(tx, product);

      const state = toProductState(product);
      if (patch.categoryIds !== undefined) {
        await this.repository.replaceProductCategories(
          id,
          state.categoryIds,
          tx,
        );
      }

      this.logger.log({
        msg: 'product updated',
        productId: state.id,
        sellerId: actor.id,
      });

      return state;
    });
  }

  async deleteProduct(actor: Actor, id: string): Promise<ProductState> {
    return this.repository.transaction(async (tx) => {
      const product = await this.repository.loadProductForUpdate(tx, id);
      product.delete(UniqueId.from(actor.id));

      await this.repository.updateProduct(tx, product);

      const state = toProductState(product);

      this.logger.log({
        msg: 'product deleted',
        productId: state.id,
        sellerId: actor.id,
      });

      return state;
    });
  }
}
