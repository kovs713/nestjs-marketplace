import type { PageInput } from '@app/common/application/pagination.js';

import type { ProductState } from './product.dto.js';

export type ProductView = ProductState & {
  stock?: { inStock: number; inReserved: number; syncedAt: Date };
};

export type ProductFilter = {
  page?: PageInput;
  sellerId?: string;
  categoryId?: string;
  titleContains?: string;
};
