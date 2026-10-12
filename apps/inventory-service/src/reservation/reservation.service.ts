import { Injectable, Logger } from '@nestjs/common';

import type { DbTransaction } from '@app/common';
import {
  CHECKOUT_TIMEOUT_MS,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  pgErrorConstraint,
  validateUuid,
} from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';
import { validateIdempotencyKey } from '@app/common/utils/validation.util.js';

import { StockRepository } from '../stock/stock.repository.js';
import type { StockState } from '../stock/stock.types.js';
import { requestHash } from './reservation-fingerprint.js';
import { ReservationRepository } from './reservation.repository.js';
import {
  assertCommittable,
  assertReservationDeadline,
  assertReservationItems,
  reservationItemsMatch,
} from './reservation.rules.js';
import { restoreReservations } from './reservation.snapshot.js';
import type {
  FinalizeRequest,
  ReservationOperation,
  ReservationResult,
  ReservationState,
  ReserveRequest,
} from './reservation.types.js';

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    private readonly repository: ReservationRepository,
    private readonly stock: StockRepository,
  ) {}

  // Reservation use cases

  /** Returns original acceptance, not the current status of an existing hold. */
  async reserve(req: ReserveRequest): Promise<ReservationResult> {
    validateIdempotencyKey(req.idempotencyKey);
    validateUuid(req.orderId);
    if (
      !req.items.length ||
      (req.expiresAt && !Number.isFinite(req.expiresAt.getTime()))
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'invalid reservation items');
    }
    assertReservationItems(req.items);
    const hash = requestHash(req);

    return this.reservationTransaction(req, 'reserve', hash, async (tx) => {
      let replay = await this.repository.replayResult(
        tx,
        'reserve',
        req.idempotencyKey,
        hash,
      );

      if (replay) {
        this.logReplay('reserve', req);

        return { reservations: replay, replayed: true };
      }

      const existing = await this.repository.lockOrderReservations(
        tx,
        req.orderId,
      );

      // The winner may have committed while we waited for the order row.
      replay = await this.repository.replayResult(
        tx,
        'reserve',
        req.idempotencyKey,
        hash,
      );

      if (replay) {
        this.logReplay('reserve', req);

        return { reservations: replay, replayed: true };
      }

      let reservations: ReservationState[];
      let changedStock: StockState[] = [];
      if (existing.length) {
        if (!reservationItemsMatch(existing, req.items, req.expiresAt)) {
          throw new DomainError(
            'ALREADY_EXISTS',
            'order items already reserved with a different request',
          );
        }

        reservations = existing.map((hold) => ({
          ...hold,
          status: 'active',
          updatedAt: new Date(hold.createdAt),
        }));
      } else {
        const expiresAt =
          req.expiresAt ?? new Date(Date.now() + CHECKOUT_TIMEOUT_MS);

        assertReservationDeadline(expiresAt);

        changedStock = await this.stock.reserveItems(tx, req.items);
        reservations = await this.repository.insertReservations(
          tx,
          req.items.map((item) => ({
            orderId: req.orderId,
            orderItemId: item.orderItemId,
            productId: item.productId,
            quantity: item.quantity,
            expiresAt,
          })),
        );
      }

      await this.repository.saveResult(
        tx,
        'reserve',
        req.idempotencyKey,
        hash,
        reservations,
      );

      await this.stock.recordStockChanges(tx, changedStock);

      this.logger.log({
        msg: existing.length ? 'reservation reused' : 'stock reserved',
        orderId: req.orderId,
        items: reservations.length,
      });

      return { reservations, replayed: existing.length > 0 };
    });
  }

  private logReplay(operation: string, req: FinalizeRequest): void {
    this.logger.debug({
      msg: 'reservation operation replayed',
      operation,
      orderId: req.orderId,
      idempotencyKey: req.idempotencyKey,
    });
  }

  commit(req: FinalizeRequest) {
    return this.finalizeReservations(req, 'commit');
  }

  release(req: FinalizeRequest) {
    return this.finalizeReservations(req, 'release');
  }

  /** Commit consumes stock; release only frees ACTIVE holds. Neither moves a balance twice. */
  private async finalizeReservations(
    req: FinalizeRequest,
    operation: 'commit' | 'release',
  ): Promise<ReservationResult> {
    validateIdempotencyKey(req.idempotencyKey);
    validateUuid(req.orderId);
    assertReservationItems(req.items);

    const hash = requestHash(req);

    return this.reservationTransaction(req, operation, hash, async (tx) => {
      let replay = await this.repository.replayResult(
        tx,
        operation,
        req.idempotencyKey,
        hash,
      );
      if (replay) {
        this.logReplay(operation, req);

        return { reservations: replay, replayed: true };
      }

      const existing = await this.repository.lockOrderReservations(
        tx,
        req.orderId,
      );
      replay = await this.repository.replayResult(
        tx,
        operation,
        req.idempotencyKey,
        hash,
      );
      if (replay) {
        this.logReplay(operation, req);

        return { reservations: replay, replayed: true };
      }

      if (!existing.length) {
        throw new DomainError('NOT_FOUND', 'no reservations for order');
      }

      if (req.items.length && !reservationItemsMatch(existing, req.items)) {
        throw new DomainError(
          'FAILED_PRECONDITION',
          'items do not match reservations',
        );
      }

      if (operation === 'commit') {
        for (const hold of existing) assertCommittable(hold);
      }

      const { reservations, changedStocks } =
        await this.repository.finalizeReservations(
          tx,
          req.orderId,
          operation === 'commit' ? 'committed' : 'released',
        );

      // A deadline can pass after validation. Fail a partial commit so all changes roll back.
      if (
        operation === 'commit' &&
        reservations.some((hold) => hold.status !== 'committed')
      ) {
        throw new DomainError(
          'FAILED_PRECONDITION',
          'reservation expired during commit',
        );
      }

      await this.repository.saveResult(
        tx,
        operation,
        req.idempotencyKey,
        hash,
        reservations,
      );

      await this.stock.recordStockChanges(tx, changedStocks);

      this.logger.log({
        msg: 'reservations finalized',
        operation,
        orderId: req.orderId,
        items: reservations.length,
      });

      return { reservations, replayed: changedStocks.length === 0 };
    });
  }

  // Expiry

  private async reservationTransaction(
    req: FinalizeRequest,
    operation: ReservationOperation,
    hash: string,
    work: (tx: DbTransaction) => Promise<ReservationResult>,
  ): Promise<ReservationResult> {
    try {
      return await this.stock.transaction(work);
    } catch (error) {
      const keyConflict =
        pgErrorCode(error) === PG_UNIQUE_VIOLATION &&
        pgErrorConstraint(error) === 'reserve_idempotency_pkey';

      const businessGuard =
        error instanceof DomainError &&
        ['ALREADY_EXISTS', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(
          error.code,
        );

      if (!keyConflict && !businessGuard) throw error;

      // The failed transaction is already rolled back; read the committed winner.
      const saved = await this.repository.findResult(
        operation,
        req.idempotencyKey,
      );

      if (!saved) throw error;

      if (saved.requestHash !== hash) {
        throw new DomainError(
          'ALREADY_EXISTS',
          'idempotency key used with a different request',
        );
      }

      return {
        reservations: restoreReservations(saved.response),
        replayed: true,
      };
    }
  }

  async expireReservations(): Promise<void> {
    const expired = await this.stock.transaction(async (tx) => {
      const changed = await this.repository.expireReservations(tx);
      await this.stock.recordStockChanges(tx, changed);

      return changed.length;
    });

    if (expired) {
      this.logger.log({ msg: 'reservations expired', count: expired });
    }
  }
}
