import type { Page, PageInput } from '@app/common/application/pagination.js';

import type { Order, OrderStatus } from './domain/order.js';
import type { OrderView } from './domain/order.types.js';

export interface Product {
  id: string;
  sellerId: string;
  title: string;
  priceMinor: number;
}

export interface Catalog {
  getProduct(id: string): Promise<Product>;
}

export interface Inventory {
  reserve(order: OrderView, key: string, expiresAt: Date | null): Promise<void>;
  commit(orderId: string, key: string): Promise<void>;
  release(orderId: string, key: string): Promise<void>;
}

export interface Payment {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  failureMessage?: string;
}

export interface Payments {
  create(order: OrderView): Promise<void>;
  capture(orderId: string, key: string): Promise<Payment>;
  getByOrder(orderId: string): Promise<Payment>;
  refund(orderId: string, key: string): Promise<Payment>;
}

export interface OrderStore {
  checkout(
    userId: string,
    key: string,
    /** Runs outside the acceptance transaction; a changed cart rejects checkout. */
    build: (cart: Order) => Promise<Order>,
  ): Promise<OrderView>;
  load(id: string): Promise<Order>;
  save(order: Order, expected: OrderStatus): Promise<void>;
  /** Durable intent, written before sending capture; not proof of a charge. */
  recordCaptureIntent(id: string): Promise<void>;
  /** Clears the retry marker only after inventory and payment are settled. */
  compensationDone(id: string): Promise<void>;
  recoverableIds(): Promise<string[]>;
  recoveryAttempted(id: string): Promise<void>;
  cart(userId: string): Promise<OrderView | undefined>;
  mutateCart(userId: string, mutate: (cart: Order) => void): Promise<void>;
  list(
    userId: string,
    statuses: OrderStatus[],
    page?: PageInput,
  ): Promise<Page<OrderView>>;
}
