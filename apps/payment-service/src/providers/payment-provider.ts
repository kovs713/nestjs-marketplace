import type { ProviderResult } from '../domain/payment.types.js';

export interface PaymentProvider {
  capture(): ProviderResult;
  refundReference(): string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
