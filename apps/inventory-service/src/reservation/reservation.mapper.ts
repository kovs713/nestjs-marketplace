import { toEpoch } from '@app/common';

import type { ReservationState } from './reservation.types.js';

const RESERVATION_STATUS = {
  active: 1,
  committed: 2,
  released: 3,
  expired: 4,
} as const;

export const toProtoReservation = (row: ReservationState) => ({
  id: row.id,
  orderId: row.orderId,
  orderItemId: row.orderItemId,
  productId: row.productId,
  quantity: row.quantity,
  status: RESERVATION_STATUS[row.status],
  expiresAt: toEpoch(row.expiresAt),
  createdAt: toEpoch(row.createdAt),
  updatedAt: toEpoch(row.updatedAt),
});
