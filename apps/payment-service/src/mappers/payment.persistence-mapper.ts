import { Money } from '@app/common/domain/value-objects/money.vo.js';
import { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';

import type { payments } from '../database/payment.schema.js';
import { Payment } from '../domain/payment.js';
import type { PaymentState } from '../domain/payment.types.js';

export function toPaymentDomain(row: typeof payments.$inferSelect): Payment {
  const { id, orderId, userId, amountMinor, ...rest } = fromPaymentRow(row);
  return Payment.reconstitute({
    ...rest,
    id: UniqueId.from(id),
    orderId: UniqueId.from(orderId),
    userId: UniqueId.from(userId),
    amount: Money.fromMinor(amountMinor),
  });
}

export function fromPaymentRow(
  row: typeof payments.$inferSelect,
): PaymentState {
  return {
    ...row,
    amountMinor: Money.fromMinor(row.amountMinor).minor,
    providerRef: row.providerRef ?? '',
    refundProviderRef: row.refundProviderRef ?? '',
    failureCode: row.failureCode ?? '',
    failureMessage: row.failureMessage ?? '',
  };
}

export function toPaymentRow(
  state: PaymentState,
): typeof payments.$inferInsert {
  return {
    ...state,
    providerRef: state.providerRef || null,
    refundProviderRef: state.refundProviderRef || null,
    failureCode: state.failureCode || null,
    failureMessage: state.failureMessage || null,
  };
}
