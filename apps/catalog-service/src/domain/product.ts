import { assertOwnership } from '@app/common/domain/ownership.js';
import type { Money } from '@app/common/domain/value-objects/money.vo.js';
import type { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';
import { DomainError } from '@app/common/errors/domain-error.js';

import { validateProductPatch } from './product.validation.js';

export type ProductProps = {
  readonly id: UniqueId;
  readonly sellerId: UniqueId;

  categoryIds: readonly UniqueId[];

  price: Money;
  title: string;
  description: string;
  imageUrl: string | null;

  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type ProductPatch = {
  title?: string;
  description?: string;
  price?: Money;
  imageUrl?: string | null;
  categoryIds?: readonly UniqueId[];
};

export class Product {
  private readonly data: ProductProps;

  private constructor(data: ProductProps) {
    validateProductPatch(data);

    this.data = {
      ...data,
      categoryIds: [...data.categoryIds],
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
    };
  }

  static reconstitute(data: ProductProps): Product {
    return new Product(data);
  }

  static create(data: ProductProps): Product {
    return new Product(data);
  }

  get state(): ProductProps {
    return {
      ...this.data,
      categoryIds: [...this.data.categoryIds],
      createdAt: new Date(this.data.createdAt),
      updatedAt: new Date(this.data.updatedAt),
      deletedAt: this.data.deletedAt ? new Date(this.data.deletedAt) : null,
    };
  }

  get price(): Money {
    return this.data.price;
  }

  update(sellerId: UniqueId, patch: ProductPatch, now = new Date()): void {
    if (this.data.deletedAt) {
      throw new DomainError('NOT_FOUND', 'product not found');
    }

    assertOwnership(this.data.sellerId, sellerId, 'product');
    validateProductPatch(patch);

    const hasUpdates = Object.values(patch).some(
      (value) => value !== undefined,
    );
    if (!hasUpdates) return;

    if (patch.title !== undefined) {
      this.data.title = patch.title;
    }
    if (patch.description !== undefined) {
      this.data.description = patch.description;
    }
    if (patch.price !== undefined) {
      this.data.price = patch.price;
    }
    if (patch.imageUrl !== undefined) {
      this.data.imageUrl = patch.imageUrl;
    }
    if (patch.categoryIds !== undefined) {
      this.data.categoryIds = [...patch.categoryIds];
    }

    this.data.updatedAt = new Date(now);
  }

  delete(sellerId: UniqueId, now = new Date()): void {
    if (this.data.deletedAt) {
      throw new DomainError('NOT_FOUND', 'product not found');
    }

    assertOwnership(this.data.sellerId, sellerId, 'product');

    this.data.deletedAt = new Date(now);
    this.data.updatedAt = new Date(now);
  }
}
