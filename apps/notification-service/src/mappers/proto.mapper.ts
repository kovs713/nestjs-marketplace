import { DomainError } from '@app/common/errors/domain-error.js';
import {
  Notification as NotificationProto,
  NotificationType,
} from '@app/contracts/generated/notification/v1/notification.js';

import type {
  Notification,
  NotificationKind,
} from '../database/notification.schema.js';
import { notificationKinds } from '../database/notification.schema.js';

export function toProtoType(kind: NotificationKind): NotificationType {
  const value = NotificationType[`NOTIFICATION_TYPE_${kind}`];

  if (typeof value !== 'number') {
    throw new DomainError('INVALID_ARGUMENT', 'invalid notification type');
  }

  return value;
}

export function fromProtoType(value: number): NotificationKind {
  const kind = notificationKinds.find((kind) => toProtoType(kind) === value);

  if (!kind) {
    throw new DomainError('INVALID_ARGUMENT', 'invalid notification type');
  }

  return kind;
}

export function toProto(state: Notification): NotificationProto {
  return {
    id: state.id,
    userId: state.userId,
    orderId: state.orderId ?? '',
    type: toProtoType(state.type),
    title: state.title,
    body: state.body,
    payloadJson: JSON.stringify(state.payload),
    readAt: state.readAt ? { epochMillis: state.readAt.getTime() } : undefined,
    createdAt: { epochMillis: state.createdAt.getTime() },
  };
}
