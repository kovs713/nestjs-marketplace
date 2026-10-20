import { Money, UniqueId } from '@app/common';
import { FIXED_DATE, testUuid } from '@app/common/testing/fixtures.js';

import { Payment } from './payment.js';
import type {
  CreatePaymentProps,
  PaymentProps,
  ProviderResult,
} from './payment.types.js';

export const PAYMENT_ID = testUuid(1);
export const ORDER_ID = testUuid(2);
export const OTHER_ORDER_ID = testUuid(3);
export const USER_ID = testUuid(4);

export const paymentCommand = {
  orderId: UniqueId.from(ORDER_ID),
  userId: UniqueId.from(USER_ID),
  amount: Money.fromMinor(3000),
  method: 'CARD',
} satisfies CreatePaymentProps;

export const providerSucceeded: ProviderResult = {
  provider: 'mock',
  providerRef: 'provider-ref-1',
  failureCode: '',
  failureMessage: '',
};

export const makePayment = (overrides: Partial<PaymentProps> = {}) =>
  Payment.reconstitute({
    ...paymentCommand,
    id: UniqueId.from(PAYMENT_ID),
    status: 'PENDING',
    provider: 'mock',
    providerRef: '',
    refundProviderRef: '',
    failureCode: '',
    failureMessage: '',
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  });
