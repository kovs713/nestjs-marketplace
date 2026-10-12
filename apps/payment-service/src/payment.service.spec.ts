import { createMock, type DeepMocked } from '@golevelup/ts-vitest';

import type { DbTransaction } from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';

import {
  makePayment,
  ORDER_ID,
  paymentCommand,
  USER_ID,
} from './domain/payment.fixtures.js';
import { toPaymentState } from './mappers/payment.mapper.js';
import { PaymentRepository } from './payment.repository.js';
import { PaymentService } from './payment.service.js';
import type { PaymentProvider } from './providers/payment-provider.js';

describe('PaymentService', () => {
  const request = {
    orderId: ORDER_ID,
    userId: USER_ID,
    amountMinor: 3000,
    method: 'CARD' as const,
    idempotencyKey: 'create-key-1',
  };

  let provider: DeepMocked<PaymentProvider>;
  let repository: DeepMocked<PaymentRepository>;
  let tx: DbTransaction;
  let service: PaymentService;

  beforeEach(() => {
    provider = createMock<PaymentProvider>();
    repository = createMock<PaymentRepository>();
    tx = createMock<DbTransaction>();
    provider.capture.mockReturnValue({
      provider: 'mock',
      providerRef: 'capture-ref',
      failureCode: '',
      failureMessage: '',
    });
    provider.refundReference.mockReturnValue('refund-ref');
    service = new PaymentService(provider, repository);
  });

  describe('create', () => {
    it('should validate and pass a payment command to the repository', async () => {
      // given
      const state = toPaymentState(makePayment().state);
      repository.create.mockResolvedValue(state);

      // when
      const result = await service.create(request);

      // then
      expect(result).toBe(state);
      expect(repository.create).toHaveBeenCalledWith(
        paymentCommand,
        request.idempotencyKey,
        expect.any(String),
      );
    });

    it('should reject invalid input before writing', async () => {
      // when & then
      await expect(
        service.create({ ...request, amountMinor: 0 }),
      ).rejects.toThrow(DomainError);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('capture', () => {
    it('should call the provider and save a pending payment capture', async () => {
      // given
      const payment = makePayment();
      repository.withPaymentTransaction.mockImplementation(
        async (_operation, _orderId, _key, _hash, execute) => {
          await execute(payment, tx);
          return toPaymentState(payment.state);
        },
      );

      // when
      const result = await service.capture({
        orderId: request.orderId,
        idempotencyKey: 'capture-key-1',
      });

      // then
      expect(result.status).toBe('SUCCEEDED');
      expect(provider.capture).toHaveBeenCalledOnce();
      expect(repository.saveWithHistoryAndOutbox).toHaveBeenCalledWith(
        tx,
        payment,
      );
    });

    it('should not call the provider again for a completed payment', async () => {
      // given
      const payment = makePayment({ status: 'SUCCEEDED' });
      repository.withPaymentTransaction.mockImplementation(
        async (_operation, _orderId, _key, _hash, execute) => {
          await execute(payment, tx);
          return toPaymentState(payment.state);
        },
      );

      // when
      await service.capture({
        orderId: request.orderId,
        idempotencyKey: 'capture-key-1',
      });

      // then
      expect(provider.capture).not.toHaveBeenCalled();
      expect(repository.saveWithHistoryAndOutbox).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('should refund a successful payment and save its new state', async () => {
      // given
      const payment = makePayment({ status: 'SUCCEEDED' });
      repository.withPaymentTransaction.mockImplementation(
        async (_operation, _orderId, _key, _hash, execute) => {
          await execute(payment, tx);
          return toPaymentState(payment.state);
        },
      );

      // when
      const result = await service.refund({
        orderId: request.orderId,
        idempotencyKey: 'refund-key-1',
      });

      // then
      expect(result.status).toBe('REFUNDED');
      expect(provider.refundReference).toHaveBeenCalledOnce();
      expect(repository.saveWithHistoryAndOutbox).toHaveBeenCalledWith(
        tx,
        payment,
      );
    });

    it('should reject refunding a payment that is not successful', async () => {
      // given
      const payment = makePayment();
      repository.withPaymentTransaction.mockImplementation(
        async (_operation, _orderId, _key, _hash, execute) => {
          await execute(payment, tx);
          return toPaymentState(payment.state);
        },
      );

      // when & then
      await expect(
        service.refund({
          orderId: request.orderId,
          idempotencyKey: 'refund-key-1',
        }),
      ).rejects.toThrow(DomainError);
      expect(repository.saveWithHistoryAndOutbox).not.toHaveBeenCalled();
    });
  });
});
