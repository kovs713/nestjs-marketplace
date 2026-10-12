import {
  CHECKOUT_TIMEOUT_MS,
  DomainError,
  Money,
  Quantity,
  UniqueId,
} from '@app/common';
import { FIXED_DATE, testUuid } from '@app/common/testing/fixtures.js';

import type { OrderItem, OrderState } from './order.js';
import { Order } from './order.js';

describe('Order', () => {
  const orderId = UniqueId.from(testUuid(1));
  const userId = UniqueId.from(testUuid(2));
  const otherUserId = UniqueId.from(testUuid(3));
  const firstItemId = UniqueId.from(testUuid(4));
  const firstProductId = UniqueId.from(testUuid(5));
  const sellerId = UniqueId.from(testUuid(6));
  const paymentTimeoutAt = new Date(FIXED_DATE.getTime() + CHECKOUT_TIMEOUT_MS);

  const item = (overrides: Partial<OrderItem> = {}): OrderItem => ({
    id: firstItemId,
    orderId,
    productId: firstProductId,
    sellerId,
    productName: 'Keyboard',
    unitPrice: Money.fromMinor(1500),
    quantity: Quantity.from(2),
    createdAt: new Date(FIXED_DATE),
    ...overrides,
  });

  const makeOrder = (overrides: Partial<OrderState> = {}) =>
    Order.reconstitute({
      id: orderId,
      userId,
      items: [],
      status: 'DRAFT',
      total: null,
      captureIntentRecorded: false,
      compensationPending: false,
      failureReason: null,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
      paymentTimeoutAt: null,
      ...overrides,
    });

  describe('state', () => {
    it('should return copied dates and items', () => {
      // given
      const sourceItem = item();
      const order = makeOrder({ items: [sourceItem] });

      // when
      sourceItem.createdAt.setTime(0);
      const state = order.state;
      state.items[0].createdAt.setTime(0);
      state.createdAt.setTime(0);

      // then
      expect(order.state.items[0].createdAt).toEqual(FIXED_DATE);
      expect(order.state.createdAt).toEqual(FIXED_DATE);
    });
  });

  describe('checkout', () => {
    it('should fix item prices and calculate the total', () => {
      // given
      const order = makeOrder();
      const first = item();
      const second = item({
        id: UniqueId.from(testUuid(7)),
        productId: UniqueId.from(testUuid(8)),
        unitPrice: Money.fromMinor(250),
        quantity: Quantity.from(3),
      });

      // when
      order.checkout(userId, [first, second], paymentTimeoutAt);

      // then
      expect(order.state).toMatchObject({
        status: 'PENDING_PAYMENT',
        total: Money.fromMinor(3750),
        paymentTimeoutAt,
        captureIntentRecorded: false,
        compensationPending: false,
      });
      expect(order.state.items).toHaveLength(2);
    });

    it.each([
      { why: 'cart is empty', items: [] },
      {
        why: 'product is duplicated',
        items: [item(), item({ id: UniqueId.from(testUuid(7)) })],
      },
      {
        why: 'price is not fixed',
        items: [item({ unitPrice: null })],
      },
      {
        why: 'total is zero',
        items: [item({ unitPrice: Money.zero() })],
      },
    ])('should reject when $why', ({ items }) => {
      // given
      const order = makeOrder();

      // when & then
      expect(() => order.checkout(userId, items, paymentTimeoutAt)).toThrow(
        DomainError,
      );
      expect(order.status).toBe('DRAFT');
    });

    it('should reject checkout by another user', () => {
      // given
      const order = makeOrder();

      // when & then
      expect(() =>
        order.checkout(otherUserId, [item()], paymentTimeoutAt),
      ).toThrow(DomainError);
    });
  });

  describe('cart items', () => {
    it('should combine quantities for the same product', () => {
      // given
      const order = makeOrder({ items: [item()] });

      // when
      order.addCartItem(userId, item({ quantity: Quantity.from(3) }));

      // then
      expect(order.state.items).toHaveLength(1);
      expect(order.state.items[0].quantity).toEqual(Quantity.from(5));
    });

    it('should reject an item from another order', () => {
      // given
      const order = makeOrder();
      const foreignItem = item({ orderId: UniqueId.from(testUuid(9)) });

      // when & then
      expect(() => order.addCartItem(userId, foreignItem)).toThrow(DomainError);
    });

    it('should change and remove an existing item', () => {
      // given
      const order = makeOrder({ items: [item()] });

      // when
      order.changeCartItemQuantity(userId, firstItemId, Quantity.from(4));

      // then
      expect(order.state.items[0].quantity).toEqual(Quantity.from(4));

      // when
      order.removeCartItem(userId, firstItemId);

      // then
      expect(order.state.items).toHaveLength(0);
    });

    it('should reject changing or removing an unknown item', () => {
      // given
      const order = makeOrder();
      const unknownItemId = UniqueId.from(testUuid(10));

      // when & then
      expect(() =>
        order.changeCartItemQuantity(userId, unknownItemId, Quantity.from(2)),
      ).toThrow(DomainError);
      expect(() => order.removeCartItem(userId, unknownItemId)).toThrow(
        DomainError,
      );
    });
  });

  describe('payment transitions', () => {
    it('should transition from pending payment to paid and confirmed', () => {
      // given
      const order = makeOrder({ status: 'PENDING_PAYMENT' });

      // when
      order.paid();

      // then
      expect(order.status).toBe('PAID');

      // when
      order.confirm();

      // then
      expect(order.status).toBe('CONFIRMED');
    });

    it('should reject invalid payment transitions', () => {
      // given
      const order = makeOrder();

      // when & then
      expect(() => order.paid()).toThrow(DomainError);
      expect(() => order.confirm()).toThrow(DomainError);
    });
  });

  describe('cancel', () => {
    it('should cancel a pending order and require compensation', () => {
      // given
      const order = makeOrder({ status: 'PENDING_PAYMENT' });

      // when
      order.cancel();

      // then
      expect(order.state).toMatchObject({
        status: 'CANCELED',
        compensationPending: true,
      });
    });

    it('should cancel a draft without compensation', () => {
      // given
      const order = makeOrder();

      // when
      order.cancel();

      // then
      expect(order.state).toMatchObject({
        status: 'CANCELED',
        compensationPending: false,
      });
    });

    it('should reject cancellation after payment', () => {
      // given
      const order = makeOrder({ status: 'PAID' });

      // when & then
      expect(() => order.cancel()).toThrow(DomainError);
    });
  });

  describe('fail', () => {
    it('should fail a pending order and require compensation', () => {
      // given
      const order = makeOrder({ status: 'PENDING_PAYMENT' });

      // when
      order.fail('payment declined');

      // then
      expect(order.state).toMatchObject({
        status: 'FAILED',
        failureReason: 'payment declined',
        compensationPending: true,
      });
    });

    it('should reject failure of a draft order', () => {
      // given
      const order = makeOrder();

      // when & then
      expect(() => order.fail('payment declined')).toThrow(DomainError);
    });
  });
});
