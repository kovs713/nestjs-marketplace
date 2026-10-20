import { createMock, type DeepMocked } from '@golevelup/ts-vitest';

import type { DbTransaction } from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';
import { FIXED_DATE, testUuid } from '@app/common/testing/fixtures.js';

import { CatalogClient } from '../catalog/catalog.client.js';
import { StockRepository } from './stock.repository.js';
import { StockService } from './stock.service.js';
import type { StockState } from './stock.types.js';

describe('StockService', () => {
  const productId = testUuid(1);
  const sellerId = testUuid(2);
  const otherSellerId = testUuid(3);
  const actor = { id: sellerId };
  const stock: StockState = {
    productId,
    inStock: 10,
    inReserved: 2,
    revision: 1,
    updatedAt: FIXED_DATE,
  };

  let repository: DeepMocked<StockRepository>;
  let catalog: DeepMocked<CatalogClient>;
  let tx: DbTransaction;
  let service: StockService;

  beforeEach(() => {
    repository = createMock<StockRepository>();
    catalog = createMock<CatalogClient>();
    tx = createMock<DbTransaction>();
    repository.transaction.mockImplementation(async (work) => work(tx));
    catalog.sellerId.mockResolvedValue(sellerId);
    service = new StockService(repository, catalog);
  });

  describe('getStock', () => {
    it('should return stock by product id', async () => {
      // given
      repository.stockById.mockResolvedValue(stock);

      // when
      const result = await service.getStock(productId);

      // then
      expect(result).toBe(stock);
      expect(repository.stockById).toHaveBeenCalledWith(productId);
    });

    it('should reject when stock does not exist', async () => {
      // given
      repository.stockById.mockResolvedValue(undefined);

      // when & then
      await expect(service.getStock(productId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('initializeStock', () => {
    it('should record a newly inserted stock row', async () => {
      // given
      repository.insertStock.mockResolvedValue([stock]);

      // when
      await service.initializeStock(productId, stock.inStock, tx);

      // then
      expect(repository.insertStock).toHaveBeenCalledWith(
        tx,
        productId,
        stock.inStock,
      );
      expect(repository.recordStockInitialized).toHaveBeenCalledWith(tx, stock);
      expect(repository.stockById).not.toHaveBeenCalled();
    });

    it('should load and record stock when it already exists', async () => {
      // given
      repository.insertStock.mockResolvedValue([]);
      repository.stockById.mockResolvedValue(stock);

      // when
      await service.initializeStock(productId, stock.inStock, tx);

      // then
      expect(repository.stockById).toHaveBeenCalledWith(productId, tx);
      expect(repository.recordStockInitialized).toHaveBeenCalledWith(tx, stock);
    });

    it('should reject invalid stock quantities before writing', async () => {
      // when & then
      await expect(service.initializeStock(productId, -1, tx)).rejects.toThrow(
        DomainError,
      );
      expect(repository.insertStock).not.toHaveBeenCalled();
    });
  });

  describe('setStock', () => {
    it('should upsert and publish stock for the product owner', async () => {
      // given
      repository.upsertStock.mockResolvedValue([stock]);

      // when
      const result = await service.setStock(productId, stock.inStock, actor);

      // then
      expect(result).toBe(stock);
      expect(repository.upsertStock).toHaveBeenCalledWith(
        tx,
        productId,
        stock.inStock,
      );
      expect(repository.recordStockChanges).toHaveBeenCalledWith(tx, [stock]);
    });

    it('should reject a different owner before opening a transaction', async () => {
      // given
      catalog.sellerId.mockResolvedValue(otherSellerId);

      // when & then
      await expect(service.setStock(productId, 5, actor)).rejects.toThrow(
        DomainError,
      );
      expect(repository.transaction).not.toHaveBeenCalled();
    });
  });

  describe('adjustStock', () => {
    it('should update and publish the resulting stock', async () => {
      // given
      repository.incrementStock.mockResolvedValue([stock]);

      // when
      const result = await service.adjustStock(productId, -1, actor);

      // then
      expect(result).toBe(stock);
      expect(repository.incrementStock).toHaveBeenCalledWith(tx, productId, -1);
      expect(repository.recordStockChanges).toHaveBeenCalledWith(tx, [stock]);
    });

    it('should reject invalid deltas without looking up the seller', async () => {
      // when & then
      await expect(
        service.adjustStock(productId, 2_147_483_648, actor),
      ).rejects.toThrow(DomainError);
      expect(catalog.sellerId).not.toHaveBeenCalled();
    });

    it('should reject an update below reserved stock', async () => {
      // given
      repository.incrementStock.mockResolvedValue([]);

      // when & then
      await expect(service.adjustStock(productId, -10, actor)).rejects.toThrow(
        DomainError,
      );
      expect(repository.recordStockChanges).not.toHaveBeenCalled();
    });
  });
});
