import { Controller, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
  Transport,
} from '@nestjs/microservices';
import { OutboxInbox } from '@nestjs/outbox';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  NOTIFICATION_REQUESTED,
  notificationRequestedSchema,
  TOPICS,
} from '@app/contracts';
import { decodeEvent } from '@app/kafka';

import { toProto } from '../mappers/proto.mapper.js';
import { NotificationRepository } from '../repositories/notification.repository.js';
import { NotificationGateway } from './notification.gateway.js';
import { NotificationService } from './notification.service.js';

@Controller()
export class NotificationConsumer {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly inbox: OutboxInbox,
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly service: NotificationService,
    private readonly repository: NotificationRepository,
    private readonly gateway: NotificationGateway,
  ) {}

  @EventPattern<string>(TOPICS.notification, Transport.KAFKA)
  async handle(
    @Payload() payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const event = decodeEvent(payload, context.getMessage().headers, {
      [NOTIFICATION_REQUESTED]: notificationRequestedSchema,
    });
    if (!event) return;

    const { eventId } = event;

    this.logger.debug({ msg: 'notification request received', eventId });

    await this.db.transaction(async (tx) => {
      await this.inbox.processInTransaction(tx, 'notification', eventId, () =>
        this.service.receiveInTransaction(event.payload, eventId, tx),
      );
    });

    const notification = await this.repository.bySourceEventId(eventId);
    if (notification) {
      this.logger.log({
        msg: 'notification event committed',
        eventId,
        notificationId: notification.id,
        userId: notification.userId,
      });

      this.gateway.notify(notification.userId, toProto(notification));
    } else {
      this.logger.warn({ msg: 'committed notification not found', eventId });
    }
  }
}
