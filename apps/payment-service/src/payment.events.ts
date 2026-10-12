import {
  EVENT_SCHEMA_VERSION,
  NOTIFICATION_REQUESTED,
  TOPICS,
} from '@app/contracts';

import type { PaymentState } from './domain/payment.types.js';

export function toPaymentEvents(state: PaymentState) {
  if (state.status === 'PENDING') {
    return [];
  }

  const title =
    state.status === 'SUCCEEDED'
      ? 'Payment succeeded'
      : state.status === 'REFUNDED'
        ? 'Payment refunded'
        : 'Payment failed';

  return [
    {
      topic: TOPICS.notification,
      key: state.orderId,
      headers: {
        event_type: NOTIFICATION_REQUESTED,
        schema_version: EVENT_SCHEMA_VERSION,
        correlation_id: state.orderId,
      },
      payload: {
        user_id: state.userId,
        order_id: state.orderId,
        type: 'PAYMENT',
        title,
        body: title,
        payload: {
          status: state.status,
          ...(state.failureCode ? { failure_code: state.failureCode } : {}),
        },
      },
    },
  ];
}
