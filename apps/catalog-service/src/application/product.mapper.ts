import { Money, UniqueId } from '@app/common';

import type { Product, ProductPatch } from '../domain/product.js';
import type { ProductState, ProductUpdate } from './product.dto.js';

export function toProductState(product: Product): ProductState {
  const { id, sellerId, price, categoryIds, ...rest } = product.state;
  return {
    ...rest,
    id: id.value,
    sellerId: sellerId.value,
    priceMinor: price.minor,
    categoryIds: categoryIds.map((category) => category.value),
  };
}

export function toProductPatch(input: ProductUpdate): ProductPatch {
  const { priceMinor, categoryIds, ...rest } = input;
  return {
    ...rest,
    ...(priceMinor !== undefined && { price: Money.fromMinor(priceMinor) }),
    ...(categoryIds !== undefined && {
      categoryIds: categoryIds.map((id) => UniqueId.from(id)),
    }),
  };
}
