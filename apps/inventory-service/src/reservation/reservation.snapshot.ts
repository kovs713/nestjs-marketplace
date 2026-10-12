import type { ReservationState } from './reservation.types.js';

export type StoredReservation = Omit<
  ReservationState,
  'expiresAt' | 'createdAt' | 'updatedAt'
> & {
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export const restoreReservations = (
  rows: StoredReservation[],
): ReservationState[] =>
  rows.map((row) => ({
    ...row,
    expiresAt: new Date(row.expiresAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }));

export const storeReservations = (
  rows: ReservationState[],
): StoredReservation[] =>
  rows.map((r) => ({
    ...r,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
