import { createHash } from 'node:crypto';

import type { ReservationItem } from './reservation.types.js';

export const requestHash = (req: {
  orderId: string;
  items: ReservationItem[];
  expiresAt?: Date;
}) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        orderId: req.orderId,
        items: [...req.items]
          .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId))
          .map((item) => ({
            orderItemId: item.orderItemId,
            productId: item.productId,
            quantity: item.quantity,
          })),
        expiresAt: req.expiresAt?.getTime() ?? null,
      }),
    )
    .digest('hex');
