import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { PageInput } from '@app/common/application/pagination.js';
import { DomainError } from '@app/common/errors/domain-error.js';

import { CatalogRepository } from '../infrastructure/catalog.repository.js';
import type { ProductFilter, ProductView } from './catalog.dto.js';

@Injectable()
export class CatalogQueries {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly redis: Redis,
  ) {}

  async getProduct(id: string, includeDeleted = false) {
    const key = `catalog:product:${id}`;
    let product: ProductView | undefined;

    if (!includeDeleted) {
      try {
        const cached = await this.redis.get(key);
        if (cached) {
          const value = JSON.parse(cached) as ProductView;
          if (value.stock) {
            value.stock.syncedAt = new Date(value.stock.syncedAt);
          }
          product = value;
        }
      } catch {}
    }

    if (!product) {
      product = await this.repository.getProduct(id, includeDeleted);
      if (product && !includeDeleted) {
        try {
          await this.redis.set(key, JSON.stringify(product), 'EX', 60);
        } catch {}
      }
    }

    if (!product) {
      throw new DomainError('NOT_FOUND', 'product not found');
    }

    return product;
  }

  async invalidateProduct(id: string) {
    try {
      await this.redis.del(`catalog:product:${id}`);
    } catch {}
  }

  async getOwnProduct(sellerId: string, id: string) {
    const product = await this.getProduct(id);

    if (product.sellerId !== sellerId) {
      throw new DomainError('NOT_FOUND', 'product not found');
    }

    return product;
  }

  async listProducts(filter: ProductFilter) {
    return this.repository.products(filter);
  }

  async search(query: string, categoryId?: string, page?: PageInput) {
    return this.repository.products({
      titleContains: query,
      categoryId,
      page,
    });
  }

  async getCategory(id: string) {
    const category = await this.repository.categoryById(id);

    if (!category) {
      throw new DomainError('NOT_FOUND', 'category not found');
    }

    return category;
  }

  async listCategories(filter: { page?: PageInput; parentId?: string }) {
    return this.repository.categories(filter);
  }
}
