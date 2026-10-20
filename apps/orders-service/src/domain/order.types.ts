import type { OrderStatus } from './order.js';

export interface OrderItemView {
  id: string;
  orderId: string;
  productId: string;
  sellerId: string;
  productName: string;
  quantity: number;
  priceMinor: number | null;
  createdAt: Date;
}

export interface OrderView {
  id: string;
  userId: string;
  status: OrderStatus;
  totalMinor: number | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemView[];
}
