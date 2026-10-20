import { toEpoch } from '@app/common';
import type {
  OrderStatus,
  Order as ProtoOrder,
  OrderItem as ProtoOrderItem,
} from '@app/contracts/generated/orders/v1/order.js';

import type { OrderItemView, OrderView } from '../domain/order.types.js';

export const ORDER_STATUS_TO_PROTO: Record<OrderView['status'], OrderStatus> = {
  DRAFT: 1,
  PENDING_PAYMENT: 2,
  PAID: 3,
  CONFIRMED: 4,
  CANCELED: 5,
  FAILED: 6,
};

export const toProtoOrderItem = (row: OrderItemView): ProtoOrderItem => ({
  id: row.id,
  productId: row.productId,
  sellerId: row.sellerId,
  productName: row.productName,
  quantity: row.quantity,
  // 0 in DRAFT, price fixed at checkout.
  priceMinor: row.priceMinor ?? 0,
  createdAt: toEpoch(row.createdAt),
});

export const toProtoView = (row: OrderView): ProtoOrder => ({
  id: row.id,
  userId: row.userId,
  status: ORDER_STATUS_TO_PROTO[row.status],
  items: row.items.map(toProtoOrderItem),
  // 0 in DRAFT.
  totalMinor: row.totalMinor ?? 0,
  failureReason: row.failureReason ?? '',
  createdAt: toEpoch(row.createdAt),
  updatedAt: toEpoch(row.updatedAt),
});
