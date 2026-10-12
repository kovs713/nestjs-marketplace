import { toOrderView } from '../mappers/order.mapper.js';
import type { Order } from './order.js';
import type { OrderItemView, OrderView } from './order.types.js';

export type OrderSnapshot = Omit<
  OrderView,
  'createdAt' | 'updatedAt' | 'items'
> & {
  createdAt: number;
  updatedAt: number;
  items: (Omit<OrderItemView, 'createdAt'> & { createdAt: number })[];
};

export function toOrderSnapshot(order: Order): OrderSnapshot {
  const view = toOrderView(order.state);

  return {
    ...view,
    createdAt: view.createdAt.getTime(),
    updatedAt: view.updatedAt.getTime(),
    items: view.items.map((item) => ({
      ...item,
      createdAt: item.createdAt.getTime(),
    })),
  };
}

export function fromOrderSnapshot(snapshot: OrderSnapshot): OrderView {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    items: snapshot.items.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt),
    })),
  };
}
