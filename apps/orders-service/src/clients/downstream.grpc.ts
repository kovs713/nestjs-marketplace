import { status } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout, type Observable } from 'rxjs';

import { DOMAIN_ERROR_CODES, DomainError } from '@app/common';
import type { CatalogServiceClient } from '@app/contracts/generated/catalog/v1/catalog.js';
import type { InventoryServiceClient } from '@app/contracts/generated/inventory/v1/inventory.js';
import {
  PaymentMethod,
  PaymentStatus,
  type PaymentServiceClient,
  type Payment as ProtoPayment,
} from '@app/contracts/generated/payment/v1/payment.js';

import type { OrderView } from '../order/order.types.js';
import type { Catalog, Inventory, Payment, Payments } from '../ports.js';
import {
  CATALOG_CLIENT,
  INVENTORY_CLIENT,
  PAYMENT_CLIENT,
} from './downstream.tokens.js';

async function grpcCall<T>(obs: Observable<T>): Promise<T> {
  try {
    return await firstValueFrom(obs.pipe(timeout(3_000)));
  } catch (error) {
    const detail = error instanceof RpcException ? error.getError() : error;

    const e = detail as { code?: number; details?: string; message?: string };
    const code = DOMAIN_ERROR_CODES.find((code) => status[code] === e?.code);

    throw new DomainError(
      code ?? 'UNAVAILABLE',
      e?.details || e?.message || 'downstream unavailable',
    );
  }
}

function payment(value: ProtoPayment): Payment {
  const statuses: Partial<Record<PaymentStatus, Payment['status']>> = {
    [PaymentStatus.PAYMENT_STATUS_PENDING]: 'PENDING',
    [PaymentStatus.PAYMENT_STATUS_SUCCEEDED]: 'SUCCEEDED',
    [PaymentStatus.PAYMENT_STATUS_FAILED]: 'FAILED',
    [PaymentStatus.PAYMENT_STATUS_REFUNDED]: 'REFUNDED',
  };
  const mapped = statuses[value.status];

  if (!mapped) {
    throw new DomainError('INTERNAL', 'unknown payment status');
  }

  return {
    status: mapped,
    failureMessage: value.failureMessage,
  };
}

@Injectable()
export class DownstreamGrpc
  implements Catalog, Inventory, Payments, OnModuleInit
{
  private catalog!: CatalogServiceClient;
  private inventory!: InventoryServiceClient;
  private payments!: PaymentServiceClient;

  constructor(
    @Inject(CATALOG_CLIENT)
    private readonly catalogClient: ClientGrpc,
    @Inject(INVENTORY_CLIENT)
    private readonly inventoryClient: ClientGrpc,
    @Inject(PAYMENT_CLIENT)
    private readonly paymentClient: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.catalog = this.catalogClient.getService('CatalogService');
    this.inventory = this.inventoryClient.getService('InventoryService');
    this.payments = this.paymentClient.getService('PaymentService');
  }

  // Catalog

  async getProduct(id: string) {
    const product = await grpcCall(this.catalog.getProduct({ id }));

    return {
      id: product.id,
      sellerId: product.sellerId,
      title: product.title,
      priceMinor: product.priceMinor,
    };
  }

  // Inventory

  async reserve(
    order: OrderView,
    key: string,
    expiresAt: Date | null,
  ): Promise<void> {
    await grpcCall(
      this.inventory.reserve({
        orderId: order.id,
        items: order.items.map((item) => ({
          orderItemId: item.id,
          productId: item.productId,
          quantity: item.quantity,
        })),
        idempotencyKey: key,
        expiresAt: expiresAt ? { epochMillis: expiresAt.getTime() } : undefined,
      }),
    );
  }

  async commit(orderId: string, key: string): Promise<void> {
    await grpcCall(
      this.inventory.commit({ orderId, items: [], idempotencyKey: key }),
    );
  }

  async release(orderId: string, key: string): Promise<void> {
    await grpcCall(
      this.inventory.release({ orderId, items: [], idempotencyKey: key }),
    );
  }

  // Payments

  async create(order: OrderView): Promise<void> {
    await grpcCall(
      this.payments.create({
        orderId: order.id,
        userId: order.userId,
        amountMinor: order.totalMinor ?? 0,
        method: PaymentMethod.PAYMENT_METHOD_CARD,
        idempotencyKey: `create:${order.id}`,
      }),
    );
  }

  async capture(orderId: string, key: string): Promise<Payment> {
    return payment(
      await grpcCall(this.payments.capture({ orderId, idempotencyKey: key })),
    );
  }

  async getByOrder(orderId: string): Promise<Payment> {
    return payment(await grpcCall(this.payments.getByOrder({ orderId })));
  }

  async refund(orderId: string, key: string): Promise<Payment> {
    return payment(
      await grpcCall(this.payments.refund({ orderId, idempotencyKey: key })),
    );
  }
}
