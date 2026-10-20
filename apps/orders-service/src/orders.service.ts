import { Logger } from '@nestjs/common';

import { CHECKOUT_TIMEOUT_MS } from '@app/common';
import type { Actor } from '@app/common/application/actor.js';
import type { Page, PageInput } from '@app/common/application/pagination.js';
import { Money } from '@app/common/domain/value-objects/money.vo.js';
import { Quantity } from '@app/common/domain/value-objects/quantity.vo.js';
import { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';
import { DomainError } from '@app/common/errors/domain-error.js';
import {
  validateIdempotencyKey,
  validateUuid,
} from '@app/common/utils/validation.util.js';
import { CheckoutRequest } from '@app/contracts/generated/orders/v1/order.js';

import { CheckoutSaga } from './checkout/checkout.saga.js';
import type { OrderItem, OrderStatus } from './domain/order.js';
import type { OrderView } from './domain/order.types.js';
import { toOrderView } from './mappers/order.mapper.js';
import type { Catalog, OrderStore } from './ports.js';

export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly store: OrderStore,
    private readonly catalog: Catalog,
    private readonly saga: CheckoutSaga,
  ) {}

  // Order lifecycle

  async checkout(actor: Actor, req: CheckoutRequest): Promise<OrderView> {
    validateIdempotencyKey(req.idempotencyKey);

    const answer = await this.store.checkout(
      actor.id,
      req.idempotencyKey,
      async (cart) => {
        const draft = cart.state;
        const now = new Date();
        const pricedItems: OrderItem[] = [];

        for (const item of draft.items) {
          const product = await this.catalog.getProduct(item.productId.value);

          if (product.id !== item.productId.value) {
            throw new DomainError(
              'INTERNAL',
              'catalog returned a different product',
            );
          }

          pricedItems.push({
            ...item,
            productId: UniqueId.from(product.id),
            sellerId: UniqueId.from(product.sellerId),
            productName: product.title,
            unitPrice: Money.fromMinor(product.priceMinor),
          });
        }

        cart.checkout(
          UniqueId.from(actor.id),
          pricedItems,
          new Date(now.getTime() + CHECKOUT_TIMEOUT_MS),
        );

        return cart;
      },
    );

    this.logger.log({
      msg: 'checkout accepted',
      orderId: answer.id,
      userId: actor.id,
      totalMinor: answer.totalMinor,
    });

    return answer;
  }

  async cancel(actor: Actor, id: string): Promise<OrderView> {
    validateUuid(id);

    const view = await this.saga.cancel(actor.id, id);

    this.logger.log({ msg: 'order canceled', orderId: id, userId: actor.id });

    return view;
  }

  // Order queries

  async get(actor: Actor, id: string): Promise<OrderView> {
    validateUuid(id);

    const order = await this.store.load(id);

    order.own(UniqueId.from(actor.id));

    return toOrderView(order.state);
  }

  async list(
    actor: Actor,
    req: { statuses: OrderStatus[]; page?: PageInput },
  ): Promise<Page<OrderView>> {
    if (
      req.page?.limit !== undefined &&
      (!Number.isSafeInteger(req.page.limit) || req.page.limit < 0)
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'invalid page limit');
    }

    if (req.page?.cursor) {
      const decoded = Buffer.from(req.page.cursor, 'base64').toString('utf8');

      if (Buffer.from(decoded).toString('base64') !== req.page.cursor) {
        throw new DomainError('INVALID_ARGUMENT', 'invalid page cursor');
      }

      validateUuid(decoded);
    }

    return this.store.list(actor.id, req.statuses, req.page);
  }

  // Cart operations

  async getCart(actor: Actor): Promise<OrderView> {
    const cart = await this.store.cart(actor.id);

    return (
      cart ?? {
        id: '',
        userId: actor.id,
        status: 'DRAFT',
        totalMinor: null,
        failureReason: null,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    );
  }

  async addToCart(
    actor: Actor,
    req: { productId: string; quantity: number },
  ): Promise<OrderView> {
    validateUuid(req.productId);

    const quantity = Quantity.from(req.quantity);

    const product = await this.catalog.getProduct(req.productId);

    if (product.id !== req.productId) {
      throw new DomainError('INTERNAL', 'catalog returned a different product');
    }

    validateUuid(product.sellerId);

    this.logger.debug({
      msg: 'cart item added',
      userId: actor.id,
      productId: product.id,
      quantity: quantity.value,
    });

    await this.store.mutateCart(actor.id, (cart) => {
      cart.addCartItem(UniqueId.from(actor.id), {
        id: UniqueId.create(),
        orderId: cart.state.id,
        createdAt: new Date(),
        productId: UniqueId.from(product.id),
        sellerId: UniqueId.from(product.sellerId),
        productName: product.title,
        quantity,
        unitPrice: null,
      });
    });

    return this.getCart(actor);
  }

  async updateCartItem(
    actor: Actor,
    req: { orderItemId: string; quantity: number },
  ): Promise<OrderView> {
    const quantity = Quantity.from(req.quantity);
    const userId = UniqueId.from(actor.id);
    const itemId = UniqueId.from(req.orderItemId);

    this.logger.debug({
      msg: 'cart item quantity changed',
      userId: actor.id,
      orderItemId: req.orderItemId,
      quantity: quantity.value,
    });

    await this.store.mutateCart(actor.id, (cart) => {
      cart.changeCartItemQuantity(userId, itemId, quantity);
    });

    return this.getCart(actor);
  }

  async removeCartItem(
    actor: Actor,
    req: { orderItemId: string },
  ): Promise<OrderView> {
    const userId = UniqueId.from(actor.id);
    const itemId = UniqueId.from(req.orderItemId);

    this.logger.debug({
      msg: 'cart item removed',
      userId: actor.id,
      orderItemId: req.orderItemId,
    });

    await this.store.mutateCart(actor.id, (cart) => {
      cart.removeCartItem(userId, itemId);
    });

    return this.getCart(actor);
  }
}
