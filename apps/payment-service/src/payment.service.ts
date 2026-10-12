import { createHash } from 'node:crypto';

import {
  validateIdempotencyKey,
  validateUuid,
} from '@app/common/utils/validation.util.js';
import type {
  CaptureRequest,
  GetByOrderRequest,
  GetRequest,
  ListHistoryRequest,
  RefundRequest,
} from '@app/contracts/generated/payment/v1/payment.js';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Payment } from './domain/payment.js';
import type {
  CreatePaymentInput,
  PaymentFilter,
} from './domain/payment.types.js';
import { toPaymentCommand } from './mappers/payment.mapper.js';
import { PaymentRepository } from './payment.repository.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './providers/payment-provider.js';

const requestHash = (input: object) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
    private readonly repository: PaymentRepository,
  ) {}

  async create(request: CreatePaymentInput) {
    const { orderId, userId, amountMinor, method, idempotencyKey } = request;

    validateUuid(orderId);
    validateUuid(userId);
    validateIdempotencyKey(idempotencyKey);

    const input = { orderId, userId, amountMinor, method };
    const command = toPaymentCommand(input);

    Payment.validate(command);

    const payment = await this.repository.create(
      command,
      idempotencyKey,
      requestHash(input),
    );

    this.logger.log({
      msg: 'payment created',
      paymentId: payment.id,
      orderId,
      amountMinor,
      status: payment.status,
    });

    return payment;
  }

  async get(input: GetRequest) {
    validateUuid(input.id);

    return this.repository.byId(input.id);
  }

  async getByOrder(input: GetByOrderRequest) {
    validateUuid(input.orderId);

    return this.repository.byOrder(input.orderId);
  }

  list(input: PaymentFilter) {
    if (input.userId) {
      validateUuid(input.userId);
    }
    if (input.orderId) {
      validateUuid(input.orderId);
    }

    return this.repository.list(input);
  }

  listHistory(input: ListHistoryRequest) {
    validateUuid(input.paymentId);

    return this.repository.history(input.paymentId, input.page);
  }

  async capture(input: CaptureRequest) {
    const { orderId, idempotencyKey } = input;

    validateUuid(orderId);
    validateIdempotencyKey(idempotencyKey);

    // Row lock, payment, history, outbox and idempotency result share one transaction.
    const payment = await this.repository.withPaymentTransaction(
      'capture',
      orderId,
      idempotencyKey,
      requestHash({ orderId }),
      async (payment, tx) => {
        // Only PENDING calls the provider; SUCCEEDED/FAILED are no-ops, REFUNDED throws.
        if (!payment.canCapture()) return;

        // Synchronous mock only: real providers need external idempotency and reconciliation.
        const result = this.provider.capture();
        // Business declines become FAILED; provider exceptions roll back the transaction.
        payment.capture(result, new Date());
        await this.repository.saveWithHistoryAndOutbox(tx, payment);
      },
    );

    this.logger.log({
      msg: 'payment capture processed',
      paymentId: payment.id,
      orderId,
      status: payment.status,
      failureCode: payment.failureCode || undefined,
    });

    return payment;
  }

  async refund(input: RefundRequest) {
    const { orderId, idempotencyKey } = input;

    validateUuid(orderId);
    validateIdempotencyKey(idempotencyKey);

    const payment = await this.repository.withPaymentTransaction(
      'refund',
      orderId,
      idempotencyKey,
      requestHash({ orderId }),
      async (payment, tx) => {
        // Synchronous mock only: real providers need external idempotency and reconciliation.
        if (payment.refund(() => this.provider.refundReference(), new Date())) {
          await this.repository.saveWithHistoryAndOutbox(tx, payment);
        }
      },
    );

    this.logger.log({
      msg: 'payment refund processed',
      paymentId: payment.id,
      orderId,
      status: payment.status,
    });

    return payment;
  }
}
