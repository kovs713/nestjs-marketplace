import { toEpoch } from '@app/common';
import type {
  Product as ProtoProduct,
  UpdateProductRequest,
} from '@app/contracts/generated/catalog/v1/catalog.js';

import type { ProductView } from '../application/catalog.dto.js';
import type { ProductUpdate } from '../application/product.dto.js';
import type { Category } from './database/categories.schema.js';

export function toProtoProduct(row: ProductView): ProtoProduct {
  return {
    id: row.id,
    sellerId: row.sellerId,

    categoryIds: row.categoryIds,
    title: row.title,
    description: row.description,
    priceMinor: row.priceMinor,
    imageUrl: row.imageUrl ?? '',

    stock: row.stock
      ? {
          inStock: row.stock.inStock,
          inReserved: row.stock.inReserved,
          syncedAt: toEpoch(row.stock.syncedAt),
        }
      : undefined,

    createdAt: toEpoch(row.createdAt),
    updatedAt: toEpoch(row.updatedAt),
    deletedAt: row.deletedAt ? toEpoch(row.deletedAt) : undefined,
  };
}

export function toProductUpdate(req: UpdateProductRequest): ProductUpdate {
  return {
    ...(req.title !== undefined && { title: req.title }),
    ...(req.description !== undefined && {
      description: req.description,
    }),
    ...(req.priceMinor !== undefined && {
      priceMinor: req.priceMinor,
    }),
    ...(req.imageUrl !== undefined && {
      imageUrl: req.imageUrl || null,
    }),
    ...((req.replaceCategoryIds || req.categoryIds?.length) && {
      categoryIds: req.categoryIds ?? [],
    }),
  };
}

export const toProtoCategory = (row: Category) => ({
  id: row.id,
  parentId: row.parentId ?? '',

  slug: row.slug,
  title: row.title,

  createdAt: toEpoch(row.createdAt),
});
