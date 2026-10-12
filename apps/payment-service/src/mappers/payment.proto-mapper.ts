import { DomainError } from '@app/common';
import {
  PaymentMethod,
  PaymentStatus,
  type Payment as ProtoPayment,
} from '@app/contracts/generated/payment/v1/payment.js';

import type {
  HistoryEntry,
  PaymentMethod as Method,
  PaymentState,
  PaymentStatus as Status,
} from '../payment/payment.types.js';

const methods = {
  CARD: PaymentMethod.PAYMENT_METHOD_CARD,
  SBP: PaymentMethod.PAYMENT_METHOD_SBP,
  WALLET: PaymentMethod.PAYMENT_METHOD_WALLET,
};

const statuses = {
  PENDING: PaymentStatus.PAYMENT_STATUS_PENDING,
  SUCCEEDED: PaymentStatus.PAYMENT_STATUS_SUCCEEDED,
  FAILED: PaymentStatus.PAYMENT_STATUS_FAILED,
  REFUNDED: PaymentStatus.PAYMENT_STATUS_REFUNDED,
};

export function fromMethod(value: PaymentMethod): Method {
  const method = Object.entries(methods).find(([, v]) => v === value)?.[0];
  if (!method)
    throw new DomainError(
      'INVALID_ARGUMENT',
      'invalid payment amount or method',
    );
  return method as Method;
}

export function fromStatus(value: PaymentStatus): Status {
  const status = Object.entries(statuses).find(([, v]) => v === value)?.[0];
  if (!status)
    throw new DomainError('INVALID_ARGUMENT', 'invalid payment status');
  return status as Status;
}

export function toProto(p: PaymentState): ProtoPayment {
  return {
    ...p,
    method: methods[p.method],
    status: statuses[p.status],
    createdAt: { epochMillis: p.createdAt.getTime() },
    updatedAt: { epochMillis: p.updatedAt.getTime() },
  };
}

export function toProtoHistoryEntry(p: HistoryEntry) {
  return {
    id: p.id,
    paymentId: p.paymentId,
    sequence: p.sequence,
    status: statuses[p.status],
    providerResponseJson: JSON.stringify(p.providerResponse ?? {}),
    createdAt: { epochMillis: p.createdAt.getTime() },
  };
}
