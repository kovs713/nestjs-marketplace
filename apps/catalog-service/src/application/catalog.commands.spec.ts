import { createMock, type DeepMocked } from '@golevelup/ts-vitest';
import { Outbox } from '@nestjs/outbox';

import type { DbTransaction } from '@app/common';
import type { Actor } from '@app/common/application/actor.js';
import { DomainError } from '@app/common/errors/domain-error.js';

import { productProps } from '../domain/product.fixtures.js';
import { Product } from '../domain/product.js';
import { CatalogRepository } from '../infrastructure/catalog.repository.js';
import {
  CatalogCommands,
  requestHash,
  type CreateProduct,
} from './catalog.commands.js';
import { toProductState } from './product.mapper.js';

describe('CatalogCommands', () => {
  const actor: Actor = { id: productProps.sellerId.value };
  const request: CreateProduct = {
    title: 'Mechanical keyboard',
    description: 'Clicky',
    priceMinor: 1500,
    imageUrl: 'https://images.example.com/kb.png',
    categoryIds: [productProps.categoryIds[0].value],
    initialStock: 7,
    idempotencyKey: 'create-key-1',
  };

  let repository: DeepMocked<CatalogRepository>;
  let outbox: DeepMocked<Outbox>;
  let tx: DbTransaction;
  let commands: CatalogCommands;

  beforeEach(() => {
    repository = createMock<CatalogRepository>();
    outbox = createMock<Outbox>();
    tx = createMock<DbTransaction>();
    repository.transaction.mockImplementation(async (work) => work(tx));
    commands = new CatalogCommands(repository, outbox);
  });

  describe('createProduct', () => {
    it('should persist the product, categories, and stock event in one transaction', async () => {
      // when
      const product = await commands.createProduct(actor, request);

      // then
      expect(repository.transaction).toHaveBeenCalledOnce();
      expect(repository.insertProduct).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ state: expect.any(Object) }),
      );
      expect(repository.replaceProductCategories).toHaveBeenCalledWith(
        product.id,
        request.categoryIds,
        tx,
      );
      expect(outbox.add).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          key: product.id,
          payload: expect.objectContaining({
            product_id: product.id,
            seller_id: actor.id,
            initial_stock: request.initialStock,
          }),
        }),
      );
    });

    it('should return the existing product when the idempotent request is replayed', async () => {
      // given
      const existing = toProductState(
        Product.reconstitute({
          ...productProps,
          idempotencyKey: request.idempotencyKey,
          requestHash: requestHash(request),
        }),
      );
      repository.insertProduct.mockRejectedValue(
        new DomainError('ALREADY_EXISTS', 'duplicate key'),
      );
      repository.productByKey.mockResolvedValue(existing);

      // when
      const result = await commands.createProduct(actor, request);

      // then
      expect(result).toBe(existing);
      expect(repository.productByKey).toHaveBeenCalledWith(
        actor.id,
        request.idempotencyKey,
      );
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('should reject reuse of an idempotency key for a different request', async () => {
      // given
      const existing = toProductState(
        Product.reconstitute({
          ...productProps,
          idempotencyKey: request.idempotencyKey,
          requestHash: 'another-request-hash',
        }),
      );
      repository.insertProduct.mockRejectedValue(
        new DomainError('ALREADY_EXISTS', 'duplicate key'),
      );
      repository.productByKey.mockResolvedValue(existing);

      // when & then
      await expect(
        commands.createProduct(actor, request),
      ).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
        message: 'idempotency key already used with a different request',
      });
    });
  });

  describe('updateProduct', () => {
    it('should replace categories only when the patch includes them', async () => {
      // given
      const product = Product.reconstitute(productProps);
      repository.loadProductForUpdate.mockResolvedValue(product);

      // when
      await commands.updateProduct(actor, productProps.id.value, {
        title: 'Updated title',
      });

      // then
      expect(repository.updateProduct).toHaveBeenCalledWith(tx, product);
      expect(repository.replaceProductCategories).not.toHaveBeenCalled();

      // when
      await commands.updateProduct(actor, productProps.id.value, {
        categoryIds: [],
      });

      // then
      expect(repository.replaceProductCategories).toHaveBeenCalledWith(
        productProps.id.value,
        [],
        tx,
      );
    });
  });

  describe('deleteProduct', () => {
    it('should soft-delete the product in a transaction', async () => {
      // given
      const product = Product.reconstitute(productProps);
      repository.loadProductForUpdate.mockResolvedValue(product);

      // when
      const result = await commands.deleteProduct(actor, productProps.id.value);

      // then
      expect(repository.updateProduct).toHaveBeenCalledWith(tx, product);
      expect(result.deletedAt).toBeInstanceOf(Date);
    });
  });
});
