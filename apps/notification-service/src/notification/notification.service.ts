import { Injectable, Logger } from '@nestjs/common';

import type { DbTransaction } from '@app/common';
import type { PageInput } from '@app/common/application/pagination.js';
import { DomainError } from '@app/common/errors/domain-error.js';
import { validateUuid } from '@app/common/utils/validation.util.js';
import type { NotificationRequested } from '@app/contracts';

import {
  notificationKinds,
  type NotificationKind,
} from '../database/notification.schema.js';
import { NotificationRepository } from '../repositories/notification.repository.js';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly repository: NotificationRepository) {}

  async list(
    userId: string,
    input: {
      page?: PageInput;
      types?: NotificationKind[];
      unreadOnly?: boolean;
    },
  ) {
    const types = input.types?.length ? input.types : notificationKinds;
    const limit = Math.min(Math.max(input.page?.limit || 50, 1), 100);

    const page = await this.repository.list({
      userId: userId,
      types,
      unreadOnly: input.unreadOnly ?? false,
      limit,
      after: input.page?.cursor,
    });
    this.logger.debug({
      msg: 'notifications listed',
      userId,
      count: page.items.length,
      unreadOnly: input.unreadOnly ?? false,
    });
    return page;
  }

  async get(userId: string, id: string) {
    const notification = await this.repository.byIdForUser(id, userId);

    if (!notification) {
      this.logger.debug({
        msg: 'notification not found for user',
        notificationId: id,
        userId,
      });
      throw new DomainError('NOT_FOUND', 'notification not found');
    }

    return notification;
  }

  async markRead(userId: string, id: string) {
    const notification = await this.repository.markRead(id, userId);

    if (!notification) {
      this.logger.debug({
        msg: 'notification not found for mark-read',
        notificationId: id,
        userId,
      });
      throw new DomainError('NOT_FOUND', 'notification not found');
    }

    this.logger.log({
      msg: 'notification marked read',
      notificationId: id,
      userId,
    });
    return notification;
  }

  async markAllRead(
    userId: string,
    types: NotificationKind[],
  ): Promise<number> {
    const count = await this.repository.markAllRead(
      userId,
      types.length ? types : notificationKinds,
    );
    this.logger.log({ msg: 'notifications marked read', userId, count });
    return count;
  }

  async receiveInTransaction(
    input: NotificationRequested,
    sourceEventId: string,
    tx: DbTransaction,
  ) {
    validateUuid(input.user_id);
    if (input.order_id != null) {
      validateUuid(input.order_id);
    }

    if (
      !sourceEventId ||
      !notificationKinds.includes(input.type) ||
      !input.title.trim() ||
      input.title.length > 200 ||
      !input.body.trim() ||
      input.body.length > 2000
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'invalid notification');
    }

    return this.repository.insert(
      {
        userId: input.user_id.toLowerCase(),
        orderId: input.order_id?.toLowerCase() ?? null,
        sourceEventId,
        type: input.type,
        title: input.title,
        body: input.body,
        payload: input.payload ?? {},
      },
      tx,
    );
  }
}
