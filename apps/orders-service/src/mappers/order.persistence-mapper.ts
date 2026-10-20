import { Money, Quantity, UniqueId } from '@app/common';

import type { OrderItem as StoredOrderItem } from '../database/order-items.schema.js';
import type { Order as StoredOrder } from '../database/orders.schema.js';
import { Order, type OrderItem } from '../domain/order.js';

export type OrderRecord = Omit<StoredOrder, 'recoveryAttemptedAt'> & {
  items: StoredOrderItem[];
};

function toOrderItemState(row: StoredOrderItem): OrderItem {
  const { id, orderId, productId, sellerId, quantity, priceMinor, ...rest } =
    row;

  return {
    ...rest,
    id: UniqueId.from(id),
    orderId: UniqueId.from(orderId),
    productId: UniqueId.from(productId),
    sellerId: UniqueId.from(sellerId),

    quantity: Quantity.from(quantity),
    unitPrice: priceMinor === null ? null : Money.fromMinor(priceMinor),
  };
}

export function toOrderDomain(row: OrderRecord): Order {
  const { id, userId, items, totalMinor, ...rest } = row;

  return Order.reconstitute({
    ...rest,
    id: UniqueId.from(id),
    userId: UniqueId.from(userId),
    total: totalMinor === null ? null : Money.fromMinor(totalMinor),
    items: items.map(toOrderItemState),
  });
}
