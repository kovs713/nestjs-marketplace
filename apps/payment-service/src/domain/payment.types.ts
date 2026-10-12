import type { PageInput } from '@app/common/application/pagination.js';
import type { Money } from '@app/common/domain/value-objects/money.vo.js';
import type { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';
import type { CreateRequest } from '@app/contracts/generated/payment/v1/payment.js';

export type PaymentMethod = 'CARD' | 'SBP' | 'WALLET';

export const PAYMENT_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REFUNDED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type CreatePaymentProps = Readonly<{
  orderId: UniqueId;
  userId: UniqueId;
  amount: Money;
  method: PaymentMethod;
}>;

export interface ProviderResult {
  provider: string;
  providerRef: string;
  failureCode: string;
  failureMessage: string;
}

export type PaymentProps = CreatePaymentProps &
  Readonly<
    ProviderResult & {
      id: UniqueId;
      refundProviderRef: string;
      status: PaymentStatus;
      createdAt: Date;
      updatedAt: Date;
    }
  >;

export type CreatePaymentInput = Omit<CreateRequest, 'method'> & {
  method: PaymentMethod;
};

export interface PaymentState {
  id: string;
  orderId: string;
  userId: string;
  amountMinor: number;
  method: PaymentMethod;
  status: PaymentStatus;
  provider: string;
  providerRef: string;
  refundProviderRef: string;
  failureCode: string;
  failureMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

export type Operation = 'create' | 'capture' | 'refund';

export interface SavedPayment {
  requestHash: string;
  response: PaymentState;
}

export interface HistoryEntry {
  id: string;
  paymentId: string;
  sequence: number;
  status: PaymentState['status'];
  providerResponse: unknown;
  createdAt: Date;
}

export interface PaymentFilter {
  userId?: string;
  orderId?: string;
  statuses: PaymentState['status'][];
  page?: PageInput;
}
