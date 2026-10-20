import { Money } from '@app/common/domain/value-objects/money.vo.js';
import { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';

import type {
  CreatePaymentInput,
  CreatePaymentProps,
  PaymentProps,
  PaymentState,
} from '../domain/payment.types.js';

export function toPaymentCommand(
  input: Omit<CreatePaymentInput, 'idempotencyKey'>,
): CreatePaymentProps {
  return {
    orderId: UniqueId.from(input.orderId),
    userId: UniqueId.from(input.userId),
    amount: Money.fromMinor(input.amountMinor),
    method: input.method,
  };
}

export function toPaymentState(props: PaymentProps): PaymentState {
  const { id, orderId, userId, amount, ...rest } = props;
  return {
    ...rest,
    id: id.value,
    orderId: orderId.value,
    userId: userId.value,
    amountMinor: amount.minor,
    createdAt: new Date(props.createdAt),
    updatedAt: new Date(props.updatedAt),
  };
}
