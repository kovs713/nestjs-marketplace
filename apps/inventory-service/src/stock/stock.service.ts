import { Injectable, Logger } from '@nestjs/common';

import {
  StockQuantity,
  UniqueId,
  validateUuid,
  type DbTransaction,
} from '@app/common';
import type { Actor } from '@app/common/application/actor.js';
import { assertOwnership } from '@app/common/domain/ownership.js';
import { DomainError } from '@app/common/errors/domain-error.js';
import { ListStocksRequest } from '@app/contracts/generated/inventory/v1/inventory.js';

import { CatalogClient } from '../catalog/catalog.client.js';
import { StockRepository } from './stock.repository.js';
import type { StockState } from './stock.types.js';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly repository: StockRepository,
    private readonly catalog: CatalogClient,
  ) {}

  async getStock(productId: string): Promise<StockState> {
    const row = await this.repository.stockById(productId);

    if (!row) {
      throw new DomainError('NOT_FOUND', 'stock not found');
    }

    return row;
  }

  async listStocks(req: ListStocksRequest) {
    return this.repository.listStocks(req);
  }

  async initializeStock(
    productId: string,
    inStock: number,
    tx: DbTransaction,
  ): Promise<void> {
    validateUuid(productId);
    StockQuantity.from(inStock);

    const [inserted] = await this.repository.insertStock(
      tx,
      productId,
      inStock,
    );
    const stock = inserted ?? (await this.repository.stockById(productId, tx));

    if (!stock) {
      throw new DomainError('INTERNAL', 'stock missing after initialization');
    }

    await this.repository.recordStockInitialized(tx, stock);

    this.logger.debug({
      msg: 'stock initialized',
      productId,
      inStock: stock.inStock,
    });
  }

  async setStock(
    productId: string,
    inStock: number,
    actor: Actor,
  ): Promise<StockState> {
    validateUuid(productId);
    StockQuantity.from(inStock);

    assertOwnership(
      UniqueId.from(await this.catalog.sellerId(productId)),
      UniqueId.from(actor.id),
      'product',
    );

    return this.repository.transaction(async (tx) => {
      const [row] = await this.repository.upsertStock(tx, productId, inStock);
      const stock = await this.recordStockChange(tx, row);

      this.logger.log({
        msg: 'stock set',
        productId,
        inStock: stock.inStock,
        actorId: actor.id,
      });

      return stock;
    });
  }

  async adjustStock(
    productId: string,
    delta: number,
    actor: Actor,
  ): Promise<StockState> {
    if (
      !Number.isInteger(delta) ||
      delta < -2_147_483_648 ||
      delta > 2_147_483_647
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'delta must be a signed int32');
    }
    validateUuid(productId);

    assertOwnership(
      UniqueId.from(await this.catalog.sellerId(productId)),
      UniqueId.from(actor.id),
      'product',
    );

    return this.repository.transaction(async (tx) => {
      const [row] = await this.repository.incrementStock(tx, productId, delta);
      if (!row) {
        throw new DomainError(
          'FAILED_PRECONDITION',
          'stock missing or below reserved quantity',
        );
      }

      const stock = await this.recordStockChange(tx, row);

      this.logger.log({
        msg: 'stock adjusted',
        productId,
        delta,
        inStock: stock.inStock,
        actorId: actor.id,
      });

      return stock;
    });
  }

  private async recordStockChange(
    tx: DbTransaction,
    stock: StockState | undefined,
  ): Promise<StockState> {
    if (!stock) {
      throw new DomainError('INTERNAL', 'stock write returned no row');
    }

    await this.repository.recordStockChanges(tx, [stock]);

    return stock;
  }
}
