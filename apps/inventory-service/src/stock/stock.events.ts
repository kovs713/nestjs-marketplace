import {
  EVENT_SCHEMA_VERSION,
  STOCK_CHANGED,
  STOCK_INITIALIZED,
  TOPICS,
} from '@app/contracts';
import type { StockState } from './stock.types.js';

export function toOutbox(
  stock: StockState,
  type: 'stock.initialized' | 'stock.changed',
) {
  return {
    topic: TOPICS.stock,
    key: stock.productId,
    headers: {
      event_type:
        type === 'stock.initialized' ? STOCK_INITIALIZED : STOCK_CHANGED,
      schema_version: EVENT_SCHEMA_VERSION,
      correlation_id: stock.productId,
    },
    payload: {
      product_id: stock.productId,
      in_stock: stock.inStock,
      in_reserved: stock.inReserved,
      revision: stock.revision,
    },
  };
}
