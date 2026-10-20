import type { ReservationState } from './reservation.types.js';
import {
  restoreReservations,
  storeReservations,
} from './reservation.snapshot.js';

describe('reservation snapshots', () => {
  const state: ReservationState = {
    id: '00000000-0000-4000-8000-000000000001',
    orderId: '00000000-0000-4000-8000-000000000002',
    orderItemId: '00000000-0000-4000-8000-000000000003',
    productId: '00000000-0000-4000-8000-000000000004',
    quantity: 3,
    status: 'active',
    expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-18T00:00:00.000Z'),
    updatedAt: new Date('2026-10-18T00:00:00.000Z'),
  };

  it('round-trips current snapshots', () => {
    const stored = storeReservations([state]);
    expect(stored[0]).toHaveProperty('quantity', 3);
    expect(restoreReservations(stored)).toEqual([state]);
  });
});
