import type { OrderItem, OrderState } from '../domain/order.js';
import type { OrderItemView, OrderView } from '../domain/order.types.js';

export function toOrderItemView(item: OrderItem): OrderItemView {
  const { id, orderId, productId, sellerId, quantity, unitPrice, ...rest } =
    item;

  return {
    ...rest,
    id: id.value,
    orderId: orderId.value,
    productId: productId.value,
    sellerId: sellerId.value,
    quantity: quantity.value,
    priceMinor: unitPrice?.minor ?? null,
  };
}

export function toOrderView(state: OrderState): OrderView {
  const {
    id,
    userId,
    items,
    total,
    status,
    failureReason,
    createdAt,
    updatedAt,
  } = state;

  return {
    status,
    failureReason,
    createdAt,
    updatedAt,
    id: id.value,
    userId: userId.value,
    totalMinor: total?.minor ?? null,
    items: items.map(toOrderItemView),
  };
}
