import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';

import { GrpcExceptionFilter } from '@app/common';
import {
  INVENTORY_SERVICE_NAME,
  type CommitRequest,
  type CommitResponse,
  type ReleaseRequest,
  type ReleaseResponse,
  type ReserveRequest,
  type ReserveResponse,
} from '@app/contracts/generated/inventory/v1/inventory.js';

import { toProtoReservation } from './reservation.mapper.js';
import { ReservationService } from './reservation.service.js';

@Controller()
@UseFilters(GrpcExceptionFilter)
export class ReservationController {
  constructor(private readonly inventory: ReservationService) {}

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'Reserve')
  async reserve(req: ReserveRequest): Promise<ReserveResponse> {
    const expiresAt = req.expiresAt
      ? new Date(Number(req.expiresAt.epochMillis))
      : undefined;

    const { reservations, replayed } = await this.inventory.reserve({
      idempotencyKey: req.idempotencyKey,
      orderId: req.orderId,
      items: req.items,
      expiresAt,
    });

    return {
      orderId: req.orderId,
      reservations: reservations.map(toProtoReservation),
      replayed,
    };
  }

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'Commit')
  async commit(req: CommitRequest): Promise<CommitResponse> {
    const { reservations, replayed } = await this.inventory.commit(req);

    return {
      orderId: req.orderId,
      reservations: reservations.map(toProtoReservation),
      replayed,
    };
  }

  @GrpcMethod(INVENTORY_SERVICE_NAME, 'Release')
  async release(req: ReleaseRequest): Promise<ReleaseResponse> {
    const { reservations, replayed } = await this.inventory.release(req);

    return {
      orderId: req.orderId,
      reservations: reservations.map(toProtoReservation),
      replayed,
    };
  }
}
