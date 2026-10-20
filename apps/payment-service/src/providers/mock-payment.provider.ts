import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { DomainError } from '@app/common';

import type { PaymentProvider } from './payment-provider.js';

const PAYMENT_OUTCOMES = ['SUCCESS', 'DECLINED', 'UNAVAILABLE'] as const;

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);

  private readonly outcome: string;

  constructor(config: ConfigService) {
    this.outcome = config.get<string>('PAYMENT_OUTCOME', 'SUCCESS');

    if (!(PAYMENT_OUTCOMES as readonly string[]).includes(this.outcome)) {
      throw new Error(
        `PAYMENT_OUTCOME must be one of ${PAYMENT_OUTCOMES.join(' | ')}`,
      );
    }
  }

  capture() {
    this.logger.debug({ msg: 'mock provider capture', outcome: this.outcome });

    if (this.outcome === 'UNAVAILABLE') {
      throw new DomainError('UNAVAILABLE', 'Mock provider unavailable');
    }

    return {
      provider: 'mock',
      providerRef: this.refundReference(),
      failureCode: this.outcome === 'DECLINED' ? 'MOCK_BUSINESS_ERROR' : '',
      failureMessage:
        this.outcome === 'DECLINED' ? 'Card declined by mock provider' : '',
    };
  }

  refundReference() {
    return `mock_${randomUUID()}`;
  }
}
