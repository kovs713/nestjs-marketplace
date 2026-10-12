import { createMock, type DeepMocked } from '@golevelup/ts-vitest';

import type { DbTransaction } from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';
import {
  FIXED_DATE,
  LATER_DATE,
  testUuid,
} from '@app/common/testing/fixtures.js';

import { StockRepository } from '../stock/stock.repository.js';
import type { StockState } from '../stock/stock.types.js';
import { ReservationRepository } from './reservation.repository.js';
import { ReservationService } from './reservation.service.js';
import type { ReservationState, ReserveRequest } from './reservation.types.js';

describe('ReservationService', () => {
  const orderId = testUuid(1);
  const item = {
    orderItemId: testUuid(2),
    productId: testUuid(3),
    quantity: 2,
  };
  const request: ReserveRequest = {
    orderId,
    idempotencyKey: 'reserve-key-1',
    items: [item],
  };
  const reservation: ReservationState = {
    id: testUuid(4),
    orderId,
    ...item,
    status: 'active',
    expiresAt: LATER_DATE,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };
  const stock: StockState = {
    productId: item.productId,
    inStock: 10,
    inReserved: 2,
    revision: 2,
    updatedAt: FIXED_DATE,
  };

  let repository: DeepMocked<ReservationRepository>;
  let stockRepository: DeepMocked<StockRepository>;
  let tx: DbTransaction;
  let service: ReservationService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
    repository = createMock<ReservationRepository>();
    stockRepository = createMock<StockRepository>();
    tx = createMock<DbTransaction>();
    stockRepository.transaction.mockImplementation(async (work) => work(tx));
    repository.replayResult.mockResolvedValue(null);
    repository.lockOrderReservations.mockResolvedValue([]);
    service = new ReservationService(repository, stockRepository);
  });

  afterEach(() => vi.useRealTimers());

  describe('reserve', () => {
    it('should reserve stock and persist the accepted result', async () => {
      // given
      stockRepository.reserveItems.mockResolvedValue([stock]);
      repository.insertReservations.mockResolvedValue([reservation]);

      // when
      const result = await service.reserve(request);

      // then
      expect(result).toEqual({ reservations: [reservation], replayed: false });
      expect(stockRepository.reserveItems).toHaveBeenCalledWith(
        tx,
        request.items,
      );
      expect(repository.insertReservations).toHaveBeenCalledWith(
        tx,
        expect.arrayContaining([
          expect.objectContaining({
            orderId,
            orderItemId: item.orderItemId,
            productId: item.productId,
            quantity: item.quantity,
          }),
        ]),
      );
      expect(repository.saveResult).toHaveBeenCalledWith(
        tx,
        'reserve',
        request.idempotencyKey,
        expect.any(String),
        [reservation],
      );
      expect(stockRepository.recordStockChanges).toHaveBeenCalledWith(tx, [
        stock,
      ]);
    });

    it('should return a saved idempotent result without reserving again', async () => {
      // given
      repository.replayResult.mockResolvedValueOnce([reservation]);

      // when
      const result = await service.reserve(request);

      // then
      expect(result).toEqual({ reservations: [reservation], replayed: true });
      expect(repository.lockOrderReservations).not.toHaveBeenCalled();
      expect(stockRepository.reserveItems).not.toHaveBeenCalled();
    });

    it('should reject a request that conflicts with existing holds', async () => {
      // given
      repository.lockOrderReservations.mockResolvedValue([reservation]);

      // when & then
      await expect(
        service.reserve({
          ...request,
          items: [{ ...item, quantity: 3 }],
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
      expect(stockRepository.reserveItems).not.toHaveBeenCalled();
    });

    it('should reject invalid requests before opening a transaction', async () => {
      // when & then
      await expect(
        service.reserve({ ...request, items: [{ ...item, quantity: 0 }] }),
      ).rejects.toThrow(DomainError);
      expect(stockRepository.transaction).not.toHaveBeenCalled();
    });
  });

  describe('commit', () => {
    it('should finalize matching active holds and publish stock changes', async () => {
      // given
      const committed = { ...reservation, status: 'committed' as const };
      repository.lockOrderReservations.mockResolvedValue([reservation]);
      repository.finalizeReservations.mockResolvedValue({
        reservations: [committed],
        changedStocks: [stock],
      });

      // when
      const result = await service.commit(request);

      // then
      expect(result).toEqual({ reservations: [committed], replayed: false });
      expect(repository.finalizeReservations).toHaveBeenCalledWith(
        tx,
        orderId,
        'committed',
      );
      expect(stockRepository.recordStockChanges).toHaveBeenCalledWith(tx, [
        stock,
      ]);
    });

    it('should reject when no holds exist', async () => {
      // when & then
      await expect(service.commit({ ...request, items: [] })).rejects.toThrow(
        DomainError,
      );
      expect(repository.finalizeReservations).not.toHaveBeenCalled();
    });

    it('should reject a partial commit so the transaction can roll back', async () => {
      // given
      repository.lockOrderReservations.mockResolvedValue([reservation]);
      repository.finalizeReservations.mockResolvedValue({
        reservations: [reservation],
        changedStocks: [stock],
      });

      // when & then
      await expect(service.commit({ ...request, items: [] })).rejects.toThrow(
        DomainError,
      );
      expect(repository.saveResult).not.toHaveBeenCalled();
      expect(stockRepository.recordStockChanges).not.toHaveBeenCalled();
    });
  });
});
