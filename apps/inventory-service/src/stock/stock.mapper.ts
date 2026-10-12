import { toEpoch } from '@app/common';

import type { StockState } from './stock.types.js';

export const toProtoStock = (row: StockState) => ({
  productId: row.productId,
  inStock: row.inStock,
  inReserved: row.inReserved,
  updatedAt: toEpoch(row.updatedAt),
});
