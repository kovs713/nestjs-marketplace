import type { Money } from '@app/common/domain/value-objects/money.vo.js';
import type { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';
import { DomainError } from '@app/common/errors/domain-error.js';

import {
  PAYMENT_STATUSES,
  type CreatePaymentProps,
  type PaymentProps,
  type ProviderResult,
} from './payment.types.js';

export class Payment {
  private constructor(private data: PaymentProps) {
    Payment.validate(data);
    if (!PAYMENT_STATUSES.includes(data.status)) {
      throw new DomainError('INVALID_ARGUMENT', 'invalid payment status');
    }

    this.data = {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  static validate(input: CreatePaymentProps) {
    if (
      input.amount.isZero() ||
      !['CARD', 'SBP', 'WALLET'].includes(input.method)
    ) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        'invalid payment amount or method',
      );
    }
  }

  static create(
    input: CreatePaymentProps,
    identity: { id: UniqueId; now: Date },
  ) {
    const payment = new Payment({
      ...input,
      id: identity.id,
      provider: 'mock',
      providerRef: '',
      refundProviderRef: '',
      failureCode: '',
      failureMessage: '',
      status: 'PENDING',
      createdAt: identity.now,
      updatedAt: identity.now,
    });
    return payment;
  }

  static reconstitute(data: PaymentProps) {
    return new Payment(data);
  }

  get state(): PaymentProps {
    return {
      ...this.data,
      createdAt: new Date(this.data.createdAt),
      updatedAt: new Date(this.data.updatedAt),
    };
  }

  get amount(): Money {
    return this.data.amount;
  }

  matches(input: CreatePaymentProps) {
    return (
      this.data.orderId.equals(input.orderId) &&
      this.data.userId.equals(input.userId) &&
      this.data.amount.equals(input.amount) &&
      this.data.method === input.method
    );
  }

  canCapture() {
    if (this.data.status === 'REFUNDED') {
      throw new DomainError(
        'FAILED_PRECONDITION',
        'refunded payment cannot be captured',
      );
    }

    return this.data.status === 'PENDING';
  }

  capture(result: ProviderResult, now: Date) {
    if (!this.canCapture()) return false;

    this.data = {
      ...this.data,
      ...result,
      status: result.failureCode ? 'FAILED' : 'SUCCEEDED',
      updatedAt: new Date(now),
    };

    return true;
  }

  refund(provideReference: () => string, now: Date) {
    if (this.data.status !== 'SUCCEEDED' && this.data.status !== 'REFUNDED') {
      throw new DomainError('FAILED_PRECONDITION', 'payment is not refundable');
    }

    if (this.data.status === 'REFUNDED') {
      return false;
    }

    this.data = {
      ...this.data,
      refundProviderRef: provideReference(),
      status: 'REFUNDED',
      failureCode: '',
      failureMessage: '',
      updatedAt: new Date(now),
    };

    return true;
  }
}
