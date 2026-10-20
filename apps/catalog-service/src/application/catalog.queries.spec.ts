import { createMock, type DeepMocked } from '@golevelup/ts-vitest';
import type { Redis } from 'ioredis';

import { CatalogRepository } from '../infrastructure/catalog.repository.js';
import { CatalogQueries } from './catalog.queries.js';

describe('CatalogQueries', () => {
  let repository: DeepMocked<CatalogRepository>;
  let redis: DeepMocked<Redis>;
  let queries: CatalogQueries;

  beforeEach(() => {
    repository = createMock<CatalogRepository>();
    redis = createMock<Redis>();
    queries = new CatalogQueries(repository, redis);
  });

  it('loads a product from the repository on cache miss and caches it', async () => {
    const product = { id: 'product-id', sellerId: 'seller-id' } as never;
    repository.getProduct.mockResolvedValue(product);
    redis.get.mockResolvedValue(null);

    await expect(queries.getProduct('product-id')).resolves.toBe(product);

    expect(repository.getProduct).toHaveBeenCalledWith('product-id', false);
    expect(redis.set).toHaveBeenCalledWith(
      'catalog:product:product-id',
      JSON.stringify(product),
      'EX',
      60,
    );
  });

  it('returns a cached product without querying the repository', async () => {
    const product = { id: 'product-id', sellerId: 'seller-id' };
    redis.get.mockResolvedValue(JSON.stringify(product));

    await expect(queries.getProduct('product-id')).resolves.toEqual(product);

    expect(repository.getProduct).not.toHaveBeenCalled();
  });
});
