import { Logger } from '@nestjs/common';

import { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';
import { DomainError } from '@app/common/errors/domain-error.js';

import type { Order } from '../domain/order.js';
import type { OrderView } from '../domain/order.types.js';
import { toOrderView } from '../mappers/order.mapper.js';
import type { Inventory, OrderStore, Payment, Payments } from '../ports.js';

const reserveKey = (id: string) => `${id}:reserve`;
const captureKey = (id: string) => `${id}:capture`;

/** Durable dispatch:
 * PENDING_PAYMENT: reserve/create, record intent, then capture/reconcile.
 * PAID: retry inventory commit; FAILED/CANCELED + compensationPending: settle.
 * Intent is not payment status. Transient errors leave checkpoints retryable;
 * stable downstream keys make replay safe after a lost response or restart.
 */
export class CheckoutSaga {
  private readonly logger = new Logger(CheckoutSaga.name);
  // ponytail: one Orders process; use a distributed lock only if adding replicas.
  private readonly active = new Set<string>();

  constructor(
    private readonly store: OrderStore,
    private readonly inventory: Inventory,
    private readonly payments: Payments,
  ) {}

  // Entry points

  /** Background delivery/recovery skips busy orders; resume/cancel reject overlap. */
  async tryResume(id: string): Promise<OrderView | undefined> {
    if (this.active.has(id.toLowerCase())) {
      return undefined;
    }

    return this.resume(id);
  }

  async resume(id: string): Promise<OrderView> {
    return this.run(id, async () => {
      const order = await this.store.load(id);

      this.logger.debug({
        msg: 'saga resumed',
        orderId: id,
        status: order.status,
        compensationPending: order.state.compensationPending,
      });

      if (order.state.compensationPending) {
        return this.compensate(order);
      }

      switch (order.status) {
        case 'PENDING_PAYMENT':
          return this.processPendingPayment(order);
        case 'PAID':
          return this.confirmPaidOrder(order);
        default:
          return toOrderView(order.state);
      }
    });
  }

  async cancel(userId: string, id: string): Promise<OrderView> {
    return this.run(id, async () => {
      const order = await this.store.load(id);

      order.own(UniqueId.from(userId));

      const previous = order.status;

      order.cancel();

      await this.store.save(order, previous);

      return order.state.compensationPending
        ? this.compensate(order)
        : toOrderView(order.state);
    });
  }

  private async run<T>(id: string, action: () => Promise<T>): Promise<T> {
    id = id.toLowerCase();

    if (this.active.has(id)) {
      throw new DomainError('UNAVAILABLE', 'order is already being processed');
    }

    this.active.add(id);

    try {
      return await action();
    } finally {
      this.active.delete(id);
    }
  }

  // Forward progress: dispatch, payment, confirmation

  private async processPendingPayment(order: Order): Promise<OrderView> {
    const {
      id: orderId,
      paymentTimeoutAt,
      captureIntentRecorded,
    } = order.state;
    const id = orderId.value;

    if (paymentTimeoutAt && paymentTimeoutAt <= new Date()) {
      return this.failAndCompensate(order, 'payment timed out');
    }

    let payment: Payment;

    if (captureIntentRecorded) {
      // Capture could already have reached Payments; reconcile before retrying.
      payment = await this.reconcileCapture(id);
    } else {
      const view = toOrderView(order.state);

      try {
        await this.inventory.reserve(view, reserveKey(id), paymentTimeoutAt);
      } catch (error) {
        if (this.businessFailure(error)) {
          return this.failAndCompensate(order, this.message(error));
        }

        throw error;
      }

      await this.payments.create(view);

      // Persist intent before capture: recovery must settle it even if the
      // request was never sent or the order was canceled. Not proof of a charge.
      await this.store.recordCaptureIntent(id);

      payment = await this.payments.capture(id, captureKey(id));
    }

    // Capture intent is persisted separately; never compensate with stale state.
    const current = await this.store.load(id);

    if (payment.status === 'PENDING') {
      return toOrderView(current.state);
    }

    if (payment.status !== 'SUCCEEDED') {
      return this.failAndCompensate(
        current,
        payment.failureMessage || 'payment failed',
      );
    }

    current.paid();
    await this.store.save(current, 'PENDING_PAYMENT');

    this.logger.log({ msg: 'order paid', orderId: id });

    return this.confirmPaidOrder(current);
  }

  private async confirmPaidOrder(order: Order): Promise<OrderView> {
    const id = order.state.id.value;

    try {
      // PAID is durable: a lost commit response replays the same reservation.
      await this.inventory.commit(id, reserveKey(id));
    } catch (error) {
      if (!this.businessFailure(error)) {
        throw error;
      }

      return this.failAndCompensate(order, this.message(error));
    }

    order.confirm();
    await this.store.save(order, 'PAID');

    this.logger.log({ msg: 'order confirmed', orderId: id });

    return toOrderView(order.state);
  }

  // Failure and compensation

  private async failAndCompensate(
    order: Order,
    reason: string,
  ): Promise<OrderView> {
    const previous = order.status;

    order.fail(reason);

    await this.store.save(order, previous);

    this.logger.warn({
      msg: 'order failed, compensating',
      orderId: order.state.id.value,
      reason,
    });

    return this.compensate(order);
  }

  private async compensate(order: Order): Promise<OrderView> {
    const {
      id: orderId,
      captureIntentRecorded,
      paymentTimeoutAt,
    } = order.state;
    const id = orderId.value;

    // Keep the active guard until both operations finish, even if one fails.
    const [inventory, payment] = await Promise.allSettled([
      this.releaseInventory(id),
      this.settlePayment(order),
    ]);

    if (inventory.status === 'rejected') {
      throw inventory.reason;
    }
    if (payment.status === 'rejected') {
      throw payment.reason;
    }

    const releaseMissing = inventory.value;
    const paymentSettled = payment.value;

    // A timed-out reserve can arrive late. NOT_FOUND is not final before its TTL.
    const reservationMayStillArrive =
      !captureIntentRecorded &&
      releaseMissing &&
      paymentTimeoutAt &&
      paymentTimeoutAt > new Date();

    if (paymentSettled && !reservationMayStillArrive) {
      await this.store.compensationDone(id);

      this.logger.debug({ msg: 'order compensation settled', orderId: id });
    } else {
      this.logger.debug({
        msg: 'order compensation pending',
        orderId: id,
        paymentSettled,
        reservationMayStillArrive,
      });
    }

    return toOrderView((await this.store.load(id)).state);
  }

  private async reconcileCapture(id: string): Promise<Payment> {
    const payment = await this.payments.getByOrder(id);

    return payment.status === 'PENDING'
      ? this.payments.capture(id, captureKey(id))
      : payment;
  }

  /** True means no reservation was found, not proof that none can arrive. */
  private async releaseInventory(id: string): Promise<boolean> {
    try {
      await this.inventory.release(id, reserveKey(id));

      return false;
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'NOT_FOUND') {
        throw error;
      }

      return true;
    }
  }

  private async settlePayment(order: Order): Promise<boolean> {
    const { id: orderId, captureIntentRecorded } = order.state;

    if (!captureIntentRecorded) {
      return true;
    }

    const id = orderId.value;

    // Settle durable intent even after cancel/timeout: Capture may precede Refund.
    const payment = await this.reconcileCapture(id);

    if (payment.status === 'SUCCEEDED') {
      return (
        (await this.payments.refund(id, `${id}:refund`)).status === 'REFUNDED'
      );
    }

    return payment.status === 'FAILED' || payment.status === 'REFUNDED';
  }

  private businessFailure(error: unknown): boolean {
    return (
      error instanceof DomainError &&
      [
        'FAILED_PRECONDITION',
        'INVALID_ARGUMENT',
        'NOT_FOUND',
        'ALREADY_EXISTS',
      ].includes(error.code)
    );
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'checkout failed';
  }
}
