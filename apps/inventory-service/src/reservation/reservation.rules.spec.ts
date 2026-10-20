import { CHECKOUT_TIMEOUT_MS } from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';
import { FIXED_DATE, LATER_DATE } from '@app/common/testing/fixtures.js';
import {
  assertCommittable,
  assertReservationDeadline,
  assertReservationItems,
  reservationItemsMatch,
} from './reservation.rules.js';

import type { ReservationItem, ReservationState } from './reservation.types.js';

describe('reservation rules', () => {
  const item: ReservationItem = {
    orderItemId: '00000000-0000-4000-8000-000000000001',
    productId: '00000000-0000-4000-8000-000000000002',
    quantity: 2,
  };
  const hold: ReservationState = {
    ...item,
    id: '00000000-0000-4000-8000-000000000003',
    orderId: '00000000-0000-4000-8000-000000000004',
    status: 'active',
    expiresAt: LATER_DATE,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };

  describe('assertReservationItems', () => {
    it('should allow valid items', () => {
      // when & then
      expect(() => assertReservationItems([item])).not.toThrow();
    });

    it.each([
      { why: 'quantity is zero', invalid: { ...item, quantity: 0 } },
      {
        why: 'order item ids are duplicated',
        invalid: { ...item, orderItemId: item.orderItemId.toUpperCase() },
      },
    ])('should reject when $why', ({ invalid }) => {
      // when & then
      expect(() => assertReservationItems([item, invalid])).toThrow(
        DomainError,
      );
    });
  });

  describe('reservationItemsMatch', () => {
    it('should match ids without depending on casing', () => {
      // when & then
      expect(
        reservationItemsMatch(
          [hold],
          [{ ...item, orderItemId: item.orderItemId.toUpperCase() }],
        ),
      ).toBe(true);
    });

    it('should reject different quantities or expiry times', () => {
      // when & then
      expect(reservationItemsMatch([hold], [{ ...item, quantity: 3 }])).toBe(
        false,
      );
      expect(reservationItemsMatch([hold], [item], FIXED_DATE)).toBe(false);
    });
  });

  describe('assertReservationDeadline', () => {
    it('should allow a deadline at the 15-minute limit', () => {
      // when & then
      expect(() =>
        assertReservationDeadline(
          new Date(FIXED_DATE.getTime() + CHECKOUT_TIMEOUT_MS),
          FIXED_DATE,
        ),
      ).not.toThrow();
    });

    it.each([
      { why: 'deadline is now', deadline: FIXED_DATE },
      {
        why: 'deadline is in the past',
        deadline: new Date(FIXED_DATE.getTime() - 1),
      },
      {
        why: 'deadline exceeds 15 minutes',
        deadline: new Date(FIXED_DATE.getTime() + CHECKOUT_TIMEOUT_MS + 1),
      },
      { why: 'deadline is invalid', deadline: new Date(Number.NaN) },
    ])('should reject when $why', ({ deadline }) => {
      // when & then
      expect(() => assertReservationDeadline(deadline, FIXED_DATE)).toThrow(
        DomainError,
      );
    });
  });

  describe('assertCommittable', () => {
    it('should allow an active hold before expiry', () => {
      // when & then
      expect(() => assertCommittable(hold, FIXED_DATE)).not.toThrow();
    });

    it('should allow an already committed hold', () => {
      // given
      const committed = { ...hold, status: 'committed' as const };

      // when & then
      expect(() => assertCommittable(committed, FIXED_DATE)).not.toThrow();
    });

    it.each([
      { why: 'hold has expired', hold: { ...hold, expiresAt: FIXED_DATE } },
      {
        why: 'hold was released',
        hold: { ...hold, status: 'released' as const },
      },
    ])('should reject when $why', ({ hold }) => {
      // when & then
      expect(() => assertCommittable(hold, FIXED_DATE)).toThrow(DomainError);
    });
  });
});
