import { DomainError, Money, type Quantity, type UniqueId } from '@app/common';
import { assertOwnership } from '@app/common/domain/ownership.js';

export interface OrderItem {
  readonly id: UniqueId;
  readonly orderId: UniqueId;
  readonly productId: UniqueId;
  readonly sellerId: UniqueId;
  readonly productName: string;
  readonly unitPrice: Money | null;
  quantity: Quantity;
  readonly createdAt: Date;
}

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'CONFIRMED'
  | 'CANCELED'
  | 'FAILED';

/** Detached domain state; value objects are immutable, dates/items are copied. */
export interface OrderState {
  id: UniqueId;
  userId: UniqueId;

  items: OrderItem[];
  status: OrderStatus;
  total: Money | null;

  /** Payment creation acknowledged and capture intent durable; not proof of a charge. */
  captureIntentRecorded: boolean;
  /** Only FAILED/CANCELED; cleared by orchestration after both compensations settle. */
  compensationPending: boolean;
  failureReason: string | null;

  createdAt: Date;
  updatedAt: Date;
  paymentTimeoutAt: Date | null;
}

function copyItem(item: OrderItem): OrderItem {
  return { ...item, createdAt: new Date(item.createdAt) };
}

function copyState(state: OrderState): OrderState {
  return {
    ...state,
    items: state.items.map(copyItem),
    createdAt: new Date(state.createdAt),
    updatedAt: new Date(state.updatedAt),
    paymentTimeoutAt: state.paymentTimeoutAt
      ? new Date(state.paymentTimeoutAt)
      : null,
  };
}

export class Order {
  private constructor(private readonly data: OrderState) {}

  // Creation and reconstitution

  static reconstitute(state: OrderState): Order {
    return new Order(copyState(state));
  }

  /** A cart is an order in DRAFT; checkout fixes its prices and starts payment. */
  checkout(userId: UniqueId, items: OrderItem[], paymentTimeoutAt: Date): void {
    this.requireDraft(userId);

    if (!items.length) {
      throw new DomainError('FAILED_PRECONDITION', 'cart is empty');
    }

    if (
      new Set(items.map((item) => item.productId.value)).size !== items.length
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'duplicate order products');
    }

    const total = items.reduce((sum, item) => {
      if (item.unitPrice === null) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          'order item price is not fixed',
        );
      }

      return sum.add(item.unitPrice.multiply(item.quantity));
    }, Money.zero());

    if (total.isZero()) {
      throw new DomainError('INVALID_ARGUMENT', 'invalid order total');
    }

    this.data.items = items.map(copyItem);
    this.data.total = total;
    this.data.status = 'PENDING_PAYMENT';
    this.data.failureReason = null;
    this.data.captureIntentRecorded = false;
    this.data.compensationPending = false;
    this.data.paymentTimeoutAt = new Date(paymentTimeoutAt);
    this.data.updatedAt = new Date();
  }

  addCartItem(userId: UniqueId, item: OrderItem): void {
    this.requireDraft(userId);

    if (!item.orderId.equals(this.data.id)) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        'cart item belongs to another order',
      );
    }

    const existing = this.data.items.find((row) =>
      row.productId.equals(item.productId),
    );

    if (existing) {
      existing.quantity = existing.quantity.add(item.quantity);
    } else {
      this.data.items.push(copyItem(item));
    }

    this.data.updatedAt = new Date();
  }

  changeCartItemQuantity(
    userId: UniqueId,
    itemId: UniqueId,
    quantity: Quantity,
  ): void {
    this.requireDraft(userId);

    const item = this.data.items.find((row) => row.id.equals(itemId));

    if (!item) {
      throw new DomainError('NOT_FOUND', 'cart item not found');
    }

    item.quantity = quantity;
    this.data.updatedAt = new Date();
  }

  removeCartItem(userId: UniqueId, itemId: UniqueId): void {
    this.requireDraft(userId);

    const index = this.data.items.findIndex((row) => row.id.equals(itemId));

    if (index === -1) {
      throw new DomainError('NOT_FOUND', 'cart item not found');
    }

    this.data.items.splice(index, 1);
    this.data.updatedAt = new Date();
  }

  private requireDraft(userId: UniqueId): void {
    this.own(userId);

    if (this.data.status !== 'DRAFT') {
      throw new DomainError('FAILED_PRECONDITION', 'cart is not a draft');
    }
  }

  // State and ownership

  get state(): OrderState {
    return copyState(this.data);
  }

  get status(): OrderStatus {
    return this.data.status;
  }

  own(userId: UniqueId): void {
    assertOwnership(this.data.userId, userId, 'order');
  }

  // Successful checkout transitions

  paid(): void {
    if (this.data.status !== 'PENDING_PAYMENT') {
      throw new DomainError(
        'FAILED_PRECONDITION',
        `order in ${this.data.status} cannot become PAID`,
      );
    }

    this.data.status = 'PAID';
    this.data.updatedAt = new Date();
  }

  confirm(): void {
    if (this.data.status !== 'PAID') {
      throw new DomainError(
        'FAILED_PRECONDITION',
        `order in ${this.data.status} cannot become CONFIRMED`,
      );
    }

    this.data.status = 'CONFIRMED';
    this.data.updatedAt = new Date();
  }

  // Cancellation and failure

  cancel(): void {
    if (
      this.data.status !== 'DRAFT' &&
      this.data.status !== 'PENDING_PAYMENT'
    ) {
      throw new DomainError(
        'FAILED_PRECONDITION',
        `order in ${this.data.status} cannot become CANCELED`,
      );
    }

    this.data.compensationPending = this.data.status === 'PENDING_PAYMENT';

    this.data.status = 'CANCELED';
    this.data.updatedAt = new Date();
  }

  fail(reason: string): void {
    if (this.data.status !== 'PENDING_PAYMENT' && this.data.status !== 'PAID') {
      throw new DomainError(
        'FAILED_PRECONDITION',
        `order in ${this.data.status} cannot become FAILED`,
      );
    }

    this.data.failureReason = reason;
    this.data.compensationPending = true;
    this.data.status = 'FAILED';
    this.data.updatedAt = new Date();
  }
}
