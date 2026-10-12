import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';

import {
  CurrentActor,
  DomainError,
  GrpcExceptionFilter,
  type Actor,
} from '@app/common';
import {
  ORDERS_SERVICE_NAME,
  type AddToCartRequest,
  type CancelRequest,
  type CheckoutRequest,
  type GetCartRequest,
  type GetRequest,
  type ListRequest,
  type RemoveCartItemRequest,
  type UpdateCartItemRequest,
} from '@app/contracts/generated/orders/v1/order.js';

import type { OrderStatus } from './domain/order.js';
import { toProtoView } from './mappers/order.proto-mapper.js';
import { OrdersService } from './orders.service.js';

@Controller()
@UseFilters(GrpcExceptionFilter)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Cart operations

  @GrpcMethod(ORDERS_SERVICE_NAME, 'GetCart')
  async getCart(@Payload() _req: GetCartRequest, @CurrentActor() actor: Actor) {
    return toProtoView(await this.orders.getCart(actor));
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'AddToCart')
  async addToCart(
    @Payload() req: AddToCartRequest,
    @CurrentActor() actor: Actor,
  ) {
    return toProtoView(await this.orders.addToCart(actor, req));
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'UpdateCartItem')
  async updateCartItem(
    @Payload() req: UpdateCartItemRequest,
    @CurrentActor() actor: Actor,
  ) {
    return toProtoView(await this.orders.updateCartItem(actor, req));
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'RemoveCartItem')
  async removeCartItem(
    @Payload() req: RemoveCartItemRequest,
    @CurrentActor() actor: Actor,
  ) {
    return toProtoView(await this.orders.removeCartItem(actor, req));
  }

  // Order lifecycle

  @GrpcMethod(ORDERS_SERVICE_NAME, 'Checkout')
  async checkout(
    @Payload() req: CheckoutRequest,
    @CurrentActor() actor: Actor,
  ) {
    return toProtoView(await this.orders.checkout(actor, req));
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'Cancel')
  async cancel(@Payload() req: CancelRequest, @CurrentActor() actor: Actor) {
    return toProtoView(await this.orders.cancel(actor, req.id));
  }

  // Order queries

  @GrpcMethod(ORDERS_SERVICE_NAME, 'Get')
  async get(@Payload() req: GetRequest, @CurrentActor() actor: Actor) {
    return toProtoView(await this.orders.get(actor, req.id));
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'List')
  async list(@Payload() req: ListRequest, @CurrentActor() actor: Actor) {
    const names = [
      'DRAFT',
      'PENDING_PAYMENT',
      'PAID',
      'CONFIRMED',
      'CANCELED',
      'FAILED',
    ] satisfies OrderStatus[];

    const statuses = req.statuses
      .filter((value) => value !== 0)
      .map((value) => {
        const name = names[value - 1];

        if (!name) {
          throw new DomainError('INVALID_ARGUMENT', 'invalid order status');
        }

        return name;
      });

    const page = await this.orders.list(actor, {
      ...req,
      statuses,
    });

    return {
      items: page.items.map(toProtoView),
      nextCursor: page.nextCursor ?? '',
    };
  }
}
