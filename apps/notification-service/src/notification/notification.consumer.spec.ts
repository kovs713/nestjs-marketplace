import { createMock, type DeepMocked } from '@golevelup/ts-vitest';
import type { KafkaContext } from '@nestjs/microservices';
import type { OutboxInbox } from '@nestjs/outbox';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { DbTransaction } from '@app/common';
import { FIXED_DATE } from '@app/common/testing/fixtures.js';
import {
  NOTIFICATION_REQUESTED,
  type NotificationRequested,
} from '@app/contracts';

import type { Notification } from '../database/notification.schema.js';
import { toProto } from '../mappers/proto.mapper.js';
import type { NotificationRepository } from '../repositories/notification.repository.js';
import { NotificationConsumer } from './notification.consumer.js';
import type { NotificationGateway } from './notification.gateway.js';
import type { NotificationService } from './notification.service.js';

describe('NotificationConsumer', () => {
  const payload: NotificationRequested = {
    user_id: '0199eb37-0000-7000-8000-000000000001',
    type: 'PAYMENT',
    title: 'Payment received',
    body: 'Your payment was received.',
  };
  const persisted: Notification = {
    id: '0199eb37-0000-7000-8000-000000000002',
    userId: '0199eb37-0000-7000-8000-000000000003',
    orderId: null,
    sourceEventId: 'event-1',
    type: 'ORDER_STATUS',
    title: 'Persisted title',
    body: 'Persisted body',
    payload: { status: 'CONFIRMED' },
    readAt: null,
    createdAt: FIXED_DATE,
  };
  let inbox: DeepMocked<OutboxInbox>;
  let db: DeepMocked<NodePgDatabase>;
  let service: DeepMocked<NotificationService>;
  let repository: DeepMocked<NotificationRepository>;
  let gateway: DeepMocked<NotificationGateway>;
  let tx: DbTransaction;
  let context: DeepMocked<KafkaContext>;
  let consumer: NotificationConsumer;

  beforeEach(() => {
    inbox = createMock<OutboxInbox>();
    db = createMock<NodePgDatabase>();
    service = createMock<NotificationService>();
    repository = createMock<NotificationRepository>();
    gateway = createMock<NotificationGateway>();
    tx = createMock<DbTransaction>();
    context = createMock<KafkaContext>();
    context.getMessage.mockReturnValue(
      createMock<ReturnType<KafkaContext['getMessage']>>({
        headers: {
          event_id: 'event-1',
          event_type: NOTIFICATION_REQUESTED,
          schema_version: '1',
        },
      }),
    );
    db.transaction.mockImplementation(async (work) => work(tx));
    inbox.processInTransaction.mockImplementation(
      async (_tx, _group, _id, work) => ({
        duplicate: false,
        result: await work(),
      }),
    );
    repository.bySourceEventId.mockResolvedValue(persisted);
    consumer = new NotificationConsumer(
      inbox,
      db,
      service,
      repository,
      gateway,
    );
  });

  it.each([false, true])(
    'notifies the persisted owner after commit (duplicate: %s)',
    async (duplicate) => {
      // given
      const order: string[] = [];
      inbox.processInTransaction.mockImplementation(
        async (_tx, _group, _id, work) => {
          order.push('inbox');
          if (duplicate) return { duplicate: true };
          return { duplicate: false, result: await work() };
        },
      );
      service.receiveInTransaction.mockImplementation(async () => {
        await Promise.resolve();
        order.push('receive');
        return persisted;
      });
      db.transaction.mockImplementation(async (work) => {
        const result = await work(tx);
        order.push('commit');
        return result;
      });
      repository.bySourceEventId.mockImplementation(async () => {
        order.push('reload');
        return persisted;
      });
      gateway.notify.mockImplementation(() => {
        order.push('notify');
      });

      // when
      await consumer.handle(payload, context);

      // then
      expect(inbox.processInTransaction).toHaveBeenCalledExactlyOnceWith(
        tx,
        'notification',
        'event-1',
        expect.any(Function),
      );
      expect(inbox.processInTransaction.mock.calls[0][0]).toBe(tx);
      if (duplicate)
        expect(service.receiveInTransaction).not.toHaveBeenCalled();
      else
        expect(service.receiveInTransaction).toHaveBeenCalledExactlyOnceWith(
          payload,
          'event-1',
          tx,
        );
      if (!duplicate)
        expect(service.receiveInTransaction.mock.calls[0][2]).toBe(tx);
      expect(repository.bySourceEventId).toHaveBeenCalledExactlyOnceWith(
        'event-1',
      );
      expect(gateway.notify).toHaveBeenCalledExactlyOnceWith(
        persisted.userId,
        toProto(persisted),
      );
      expect(order).toEqual(
        duplicate
          ? ['inbox', 'commit', 'reload', 'notify']
          : ['inbox', 'receive', 'commit', 'reload', 'notify'],
      );
    },
  );

  it.each(['receive', 'commit', 'reload', 'notify'])(
    'propagates %s failures',
    async (stage) => {
      // given
      const error = new Error(`${stage} failed`);
      if (stage === 'receive')
        service.receiveInTransaction.mockRejectedValue(error);
      if (stage === 'commit')
        db.transaction.mockImplementation(async (work) => {
          await work(tx);
          throw error;
        });
      if (stage === 'reload')
        repository.bySourceEventId.mockRejectedValue(error);
      if (stage === 'notify')
        gateway.notify.mockImplementation(() => {
          throw error;
        });

      // when & then
      await expect(consumer.handle(payload, context)).rejects.toThrow(error);

      if (stage === 'receive' || stage === 'commit')
        expect(repository.bySourceEventId).not.toHaveBeenCalled();
      if (stage !== 'notify') expect(gateway.notify).not.toHaveBeenCalled();
    },
  );

  it('does not notify when the persisted notification is absent', async () => {
    // given
    repository.bySourceEventId.mockResolvedValue(undefined);

    // when
    await consumer.handle(payload, context);

    // then
    expect(repository.bySourceEventId).toHaveBeenCalledWith('event-1');
    expect(gateway.notify).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads before opening a transaction', async () => {
    // when & then
    await expect(
      consumer.handle({ ...payload, user_id: 'invalid' }, context),
    ).rejects.toThrow();

    expect(db.transaction).not.toHaveBeenCalled();
    expect(inbox.processInTransaction).not.toHaveBeenCalled();
    expect(service.receiveInTransaction).not.toHaveBeenCalled();
    expect(repository.bySourceEventId).not.toHaveBeenCalled();
    expect(gateway.notify).not.toHaveBeenCalled();
  });

  it('skips unrelated event types before validation', async () => {
    // given
    context.getMessage.mockReturnValue(
      createMock<ReturnType<KafkaContext['getMessage']>>({
        headers: { event_type: 'unrelated.event' },
      }),
    );

    // when
    await consumer.handle(null, context);

    // then
    expect(db.transaction).not.toHaveBeenCalled();
    expect(repository.bySourceEventId).not.toHaveBeenCalled();
    expect(gateway.notify).not.toHaveBeenCalled();
  });
});
