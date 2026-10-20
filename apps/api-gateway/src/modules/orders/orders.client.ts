import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';

import type {
  AddToCartRequest,
  CancelRequest,
  CheckoutRequest,
  GetCartRequest,
  GetRequest,
  ListRequest,
  Order,
  OrderList,
  OrdersServiceClient,
  RemoveCartItemRequest,
  UpdateCartItemRequest,
} from '@app/contracts/generated/orders/v1/order.js';
import { ORDERS_SERVICE_NAME } from '@app/contracts/generated/orders/v1/order.js';

import { GrpcResilience } from '../../grpc/grpc-resilience.js';
import { ORDERS_CLIENT } from './orders.token.js';

@Injectable()
export class OrdersClient implements OnModuleInit {
  private service!: OrdersServiceClient;

  constructor(
    @Inject(ORDERS_CLIENT)
    private readonly ordersClient: ClientGrpc,
    private readonly resilience: GrpcResilience,
  ) {}
  onModuleInit(): void {
    this.service =
      this.ordersClient.getService<OrdersServiceClient>(ORDERS_SERVICE_NAME);
  }

  async addToCart(request: AddToCartRequest): Promise<Order> {
    return this.resilience.call(() => this.service.addToCart(request), {
      source: 'orders.addToCart',
    });
  }

  async getCart(request: GetCartRequest): Promise<Order> {
    return this.resilience.call(() => this.service.getCart(request), {
      source: 'orders.getCart',
      retryable: true,
    });
  }

  async updateCartItem(request: UpdateCartItemRequest): Promise<Order> {
    return this.resilience.call(() => this.service.updateCartItem(request), {
      source: 'orders.updateCartItem',
    });
  }

  async removeCartItem(request: RemoveCartItemRequest): Promise<Order> {
    return this.resilience.call(() => this.service.removeCartItem(request), {
      source: 'orders.removeCartItem',
    });
  }

  async checkout(
    request: CheckoutRequest,
    retryable?: boolean,
  ): Promise<Order> {
    return this.resilience.call(() => this.service.checkout(request), {
      source: 'orders.checkout',
      retryable: retryable,
    });
  }

  async list(request: ListRequest): Promise<OrderList> {
    return this.resilience.call(() => this.service.list(request), {
      source: 'orders.list',
      retryable: true,
    });
  }

  async get(request: GetRequest): Promise<Order> {
    return this.resilience.call(() => this.service.get(request), {
      source: 'orders.get',
      retryable: true,
    });
  }

  async cancel(request: CancelRequest) {
    return this.resilience.call(() => this.service.cancel(request), {
      source: 'orders.cancel',
    });
  }
}
