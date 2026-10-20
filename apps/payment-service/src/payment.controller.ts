import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';

import { GrpcExceptionFilter } from '@app/common';
import {
  PAYMENT_SERVICE_NAME,
  type CaptureRequest,
  type CreateRequest,
  type GetByOrderRequest,
  type GetRequest,
  type HistoryList,
  type ListHistoryRequest,
  type ListRequest,
  type Payment,
  type PaymentList,
  type RefundRequest,
} from '@app/contracts/generated/payment/v1/payment.js';

import {
  fromMethod,
  fromStatus,
  toProto,
  toProtoHistoryEntry,
} from './mappers/payment.proto-mapper.js';
import { PaymentService } from './payment.service.js';

@Controller()
@UseFilters(GrpcExceptionFilter)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @GrpcMethod(PAYMENT_SERVICE_NAME, 'Create')
  async create(data: CreateRequest): Promise<Payment> {
    return toProto(
      await this.payments.create({
        ...data,
        method: fromMethod(data.method),
      }),
    );
  }

  @GrpcMethod(PAYMENT_SERVICE_NAME, 'Get')
  async get(data: GetRequest): Promise<Payment> {
    return toProto(await this.payments.get(data));
  }

  @GrpcMethod(PAYMENT_SERVICE_NAME, 'GetByOrder')
  async getByOrder(data: GetByOrderRequest): Promise<Payment> {
    return toProto(await this.payments.getByOrder(data));
  }

  @GrpcMethod(PAYMENT_SERVICE_NAME, 'List')
  async list(data: ListRequest): Promise<PaymentList> {
    const result = await this.payments.list({
      ...data,
      statuses: data.statuses.map(fromStatus),
    });

    return {
      ...result,
      items: result.items.map(toProto),
    };
  }

  @GrpcMethod(PAYMENT_SERVICE_NAME, 'ListHistory')
  async listHistory(data: ListHistoryRequest): Promise<HistoryList> {
    const result = await this.payments.listHistory(data);

    return {
      ...result,
      items: result.items.map(toProtoHistoryEntry),
    };
  }

  @GrpcMethod(PAYMENT_SERVICE_NAME, 'Capture')
  async capture(data: CaptureRequest): Promise<Payment> {
    return toProto(await this.payments.capture(data));
  }

  @GrpcMethod(PAYMENT_SERVICE_NAME, 'Refund')
  async refund(data: RefundRequest): Promise<Payment> {
    return toProto(await this.payments.refund(data));
  }
}
