import { Money, UniqueId } from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';
import { FIXED_DATE, LATER_DATE } from '@app/common/testing/fixtures.js';

import { CATEGORY_ID, productProps } from './product.fixtures.js';
import { Product } from './product.js';

describe('Product', () => {
  describe('create', () => {
    it('should create a product with validated state', () => {
      // when
      const product = Product.create(productProps);

      // then
      expect(product.state).toEqual(productProps);
    });

    it('should not expose mutable state', () => {
      // when
      const createdAt = new Date(FIXED_DATE);
      const categoryIds = [...productProps.categoryIds];

      const product = Product.create({
        ...productProps,
        createdAt,
        categoryIds,
      });

      categoryIds.length = 0;
      createdAt.setTime(0);

      // then
      expect(product.state.categoryIds).toHaveLength(1);
      expect(product.state.createdAt).toEqual(FIXED_DATE);

      // when
      const state = product.state;
      state.updatedAt.setTime(0);

      // then
      expect(product.state.updatedAt).toEqual(FIXED_DATE);
    });
  });

  describe('reconstitute', () => {
    it('should restore product state', () => {
      // when
      const product = Product.reconstitute(productProps);

      // then
      expect(product.state).toEqual(productProps);
    });

    it.each([
      { why: 'title is blank', overrides: { title: '   ' } },
      {
        why: 'title is longer than 200 characters',
        overrides: { title: 'x'.repeat(201) },
      },
      {
        why: 'category ids repeat',
        overrides: {
          categoryIds: [UniqueId.from(CATEGORY_ID), UniqueId.from(CATEGORY_ID)],
        },
      },
    ])('should reject reconstitution when $why', ({ overrides }) => {
      // when & then
      expect(() =>
        Product.reconstitute({ ...productProps, ...overrides }),
      ).toThrow(DomainError);
    });
  });

  describe('update', () => {
    it('should apply the patch', () => {
      // given
      const product = Product.reconstitute(productProps);

      // when
      product.update(
        productProps.sellerId,
        { title: 'New title', price: Money.fromMinor(2000) },
        LATER_DATE,
      );

      // then
      expect(product.state).toMatchObject({
        title: 'New title',
        price: Money.fromMinor(2000),
        updatedAt: LATER_DATE,
      });
    });

    it('should reject an update by another seller', () => {
      // given
      const product = Product.reconstitute(productProps);

      // when & then
      expect(() =>
        product.update(UniqueId.from('0199eb37-0000-7000-8000-000000000003'), {
          title: 'Stolen',
        }),
      ).toThrow(DomainError);
    });

    it('should reject an update of a deleted product', () => {
      // given
      const product = Product.reconstitute({
        ...productProps,
        deletedAt: FIXED_DATE,
      });

      // when & then
      expect(() =>
        product.update(productProps.sellerId, { title: 'Zombie' }),
      ).toThrow(DomainError);
    });
  });

  describe('delete', () => {
    it('should mark the product as deleted', () => {
      // given
      const product = Product.reconstitute(productProps);

      // when
      product.delete(productProps.sellerId, LATER_DATE);

      // then
      expect(product.state).toMatchObject({
        deletedAt: LATER_DATE,
        updatedAt: LATER_DATE,
      });
    });

    it('should reject a delete by another seller', () => {
      // given
      const product = Product.reconstitute(productProps);

      // when & then
      expect(() =>
        product.delete(UniqueId.from('0199eb37-0000-7000-8000-000000000003')),
      ).toThrow(DomainError);
    });
  });
});
