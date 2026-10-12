import { DomainError, Money } from '@app/common';
import { FIXED_DATE, LATER_DATE } from '@app/common/testing/fixtures.js';

import {
  makePayment,
  paymentCommand,
  providerSucceeded,
} from './payment.fixtures.js';
import { Payment } from './payment.js';

describe('Payment', () => {
  describe('create', () => {
    it('should create a pending payment with copied dates', () => {
      // when
      const payment = Payment.create(paymentCommand, {
        id: paymentCommand.orderId,
        now: FIXED_DATE,
      });

      // then
      expect(payment.state).toMatchObject({
        status: 'PENDING',
        provider: 'mock',
      });
      expect(payment.state.createdAt).toEqual(FIXED_DATE);
      expect(payment.state.createdAt).not.toBe(FIXED_DATE);
    });

    it('should reject a zero amount', () => {
      // when & then
      expect(() =>
        Payment.create(
          { ...paymentCommand, amount: Money.zero() },
          { id: paymentCommand.orderId, now: FIXED_DATE },
        ),
      ).toThrow(DomainError);
    });
  });

  describe('reconstitute', () => {
    it('should reject an unknown status', () => {
      // when & then
      expect(() => makePayment({ status: 'UNKNOWN' as never })).toThrow(
        DomainError,
      );
    });
  });

  describe('matches', () => {
    it('should compare payment creation fields', () => {
      // given
      const payment = makePayment();

      // when & then
      expect(payment.matches(paymentCommand)).toBe(true);
      expect(
        payment.matches({ ...paymentCommand, amount: Money.fromMinor(1) }),
      ).toBe(false);
    });
  });

  describe('capture', () => {
    it('should capture once and record provider success', () => {
      // given
      const payment = makePayment();

      // when
      const captured = payment.capture(providerSucceeded, LATER_DATE);

      // then
      expect(captured).toBe(true);
      expect(payment.state).toMatchObject({
        status: 'SUCCEEDED',
        providerRef: 'provider-ref-1',
        updatedAt: LATER_DATE,
      });

      // when & then
      expect(payment.capture(providerSucceeded, LATER_DATE)).toBe(false);
    });

    it('should record provider failure', () => {
      // given
      const payment = makePayment();

      // when
      payment.capture(
        { ...providerSucceeded, failureCode: 'DECLINED' },
        LATER_DATE,
      );

      // then
      expect(payment.state.status).toBe('FAILED');
    });
  });

  describe('refund', () => {
    it('should refund a successful payment once', () => {
      // given
      const payment = makePayment({
        status: 'SUCCEEDED',
        providerRef: 'captured',
      });
      const reference = vi.fn(() => 'refund-1');

      // when
      const refunded = payment.refund(reference, LATER_DATE);

      // then
      expect(refunded).toBe(true);
      expect(payment.state).toMatchObject({
        status: 'REFUNDED',
        refundProviderRef: 'refund-1',
        updatedAt: LATER_DATE,
      });

      // when & then
      expect(payment.refund(reference, LATER_DATE)).toBe(false);
      expect(reference).toHaveBeenCalledTimes(1);
    });

    it('should reject refunding a payment that has not succeeded', () => {
      // given
      const payment = makePayment();

      // when & then
      expect(() => payment.refund(() => 'refund-1', LATER_DATE)).toThrow(
        DomainError,
      );
    });
  });

  describe('canCapture', () => {
    it('should reject a refunded payment', () => {
      // given
      const payment = makePayment({ status: 'REFUNDED' });

      // when & then
      expect(() => payment.canCapture()).toThrow(DomainError);
    });
  });
});
