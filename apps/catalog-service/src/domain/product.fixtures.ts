import { Money, UniqueId } from '@app/common';
import { FIXED_DATE, testUuid } from '@app/common/testing/fixtures.js';

import type { ProductProps } from './product.js';

export const PRODUCT_ID = testUuid(1);
export const SELLER_ID = testUuid(2);
export const CATEGORY_ID = testUuid(4);

export const productProps = {
  id: UniqueId.from(PRODUCT_ID),
  sellerId: UniqueId.from(SELLER_ID),
  title: 'Mechanical keyboard',
  description: 'Clicky',
  price: Money.fromMinor(1500),
  imageUrl: 'https://images.example.com/kb.png',
  categoryIds: [UniqueId.from(CATEGORY_ID)],
  idempotencyKey: 'idem-1',
  requestHash: 'hash-1',
  createdAt: FIXED_DATE,
  updatedAt: FIXED_DATE,
  deletedAt: null,
} satisfies ProductProps;
