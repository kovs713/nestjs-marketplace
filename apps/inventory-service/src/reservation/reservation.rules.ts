import { CHECKOUT_TIMEOUT_MS } from '@app/common';
import { Quantity } from '@app/common/domain/value-objects/quantity.vo.js';
import { DomainError } from '@app/common/errors/domain-error.js';
import { validateUuid } from '@app/common/utils/validation.util.js';

import type { ReservationItem, ReservationState } from './reservation.types.js';

export function assertReservationItems(items: ReservationItem[]): void {
  for (const item of items) {
    validateUuid(item.orderItemId);
    validateUuid(item.productId);
    Quantity.from(item.quantity);
  }

  if (
    new Set(items.map((item) => item.orderItemId.toLowerCase())).size !==
    items.length
  ) {
    throw new DomainError('INVALID_ARGUMENT', 'invalid reservation items');
  }
}

export function reservationItemsMatch(
  holds: ReservationState[],
  items: ReservationItem[],
  expiresAt?: Date,
): boolean {
  return (
    holds.length === items.length &&
    items.every((item) =>
      holds.some(
        (hold) =>
          hold.orderItemId.toLowerCase() === item.orderItemId.toLowerCase() &&
          hold.productId.toLowerCase() === item.productId.toLowerCase() &&
          hold.quantity === item.quantity &&
          (!expiresAt || hold.expiresAt.getTime() === expiresAt.getTime()),
      ),
    )
  );
}

/** Only NEW holds need a future deadline. Historical acceptance can replay after expiry. */
export function assertReservationDeadline(
  expiresAt: Date,
  now = new Date(),
): void {
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt <= now ||
    expiresAt.getTime() > now.getTime() + CHECKOUT_TIMEOUT_MS
  ) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'reservation TTL must be within 15 minutes',
    );
  }
}

export function assertCommittable(
  hold: ReservationState,
  now = new Date(),
): void {
  if (
    hold.status !== 'committed' &&
    (hold.status !== 'active' || hold.expiresAt <= now)
  ) {
    throw new DomainError(
      'FAILED_PRECONDITION',
      'reservation is expired or released',
    );
  }
}
