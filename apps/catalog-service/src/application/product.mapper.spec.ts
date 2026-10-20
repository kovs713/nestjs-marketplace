import { Money, UniqueId } from '@app/common';

import { CATEGORY_ID, productProps } from '../domain/product.fixtures.js';
import { Product } from '../domain/product.js';
import { toProductPatch, toProductState } from './product.mapper.js';

describe('product mapper', () => {
  describe('toProductState', () => {
    it('should map domain value objects to primitive state', () => {
      // given
      const product = Product.reconstitute(productProps);

      // when
      const state = toProductState(product);

      // then
      expect(state).toMatchObject({
        id: productProps.id.value,
        sellerId: productProps.sellerId.value,
        priceMinor: productProps.price.minor,
        categoryIds: [CATEGORY_ID],
      });
    });
  });

  describe('toProductPatch', () => {
    it('should map price and category ids', () => {
      // when
      const patch = toProductPatch({
        priceMinor: 2000,
        categoryIds: [CATEGORY_ID],
      });

      // then
      expect(patch).toEqual({
        price: Money.fromMinor(2000),
        categoryIds: [UniqueId.from(CATEGORY_ID)],
      });
    });

    it('should preserve an explicitly empty category list', () => {
      // when
      const patch = toProductPatch({ categoryIds: [] });

      // then
      expect(patch).toEqual({ categoryIds: [] });
    });

    it('should leave omitted fields undefined', () => {
      // when
      const patch = toProductPatch({ title: 'Updated' });

      // then
      expect(patch).toEqual({ title: 'Updated' });
      expect(patch).not.toHaveProperty('categoryIds');
    });
  });
});
