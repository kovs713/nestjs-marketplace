import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import type { DbTransaction } from '@app/common';
import { FIXED_DATE } from '@app/common/testing/fixtures.js';

import type { Notification } from '../database/notification.schema.js';
import type { NotificationRepository } from '../repositories/notification.repository.js';
import { NotificationService } from './notification.service.js';

describe('NotificationService', () => {
  let service: NotificationService;
  let repository: DeepMocked<NotificationRepository>;
  let tx: DbTransaction;

  const NOTIFICATION_ID = '0199eb37-0000-7000-8000-000000000001';
  const ORDER_ID = '0199eb37-0000-7000-8000-000000000002';
  const USER_ID = '0199eb37-0000-7000-8000-000000000003';

  const row: Notification = {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    orderId: null,
    sourceEventId: 'event-1',
    type: 'ORDER_STATUS',
    title: 'Order confirmed',
    body: 'Your order has been confirmed.',
    payload: {},
    readAt: null,
    createdAt: FIXED_DATE,
  };

  beforeEach(() => {
    repository = createMock<NotificationRepository>();
    tx = createMock<DbTransaction>();
    service = new NotificationService(repository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should list all kinds with default paging', async () => {
      // given
      repository.list.mockResolvedValue({ items: [row], nextCursor: 'c-1' });

      // when
      const page = await service.list(USER_ID, {});

      // then
      expect(repository.list).toHaveBeenCalledWith({
        userId: USER_ID,
        types: ['ORDER_STATUS', 'PAYMENT', 'STOCK'],
        unreadOnly: false,
        limit: 50,
        after: undefined,
      });
      expect(page.items[0]).toBe(row);
      expect(page.nextCursor).toBe('c-1');
    });

    it('should cap the limit and pass the filter through', async () => {
      // given
      repository.list.mockResolvedValue({ items: [], nextCursor: '' });

      // when
      await service.list(USER_ID, {
        page: { limit: 1000, cursor: 'c-0' },
        types: ['PAYMENT'],
        unreadOnly: true,
      });

      // then
      expect(repository.list).toHaveBeenCalledWith({
        userId: USER_ID,
        types: ['PAYMENT'],
        unreadOnly: true,
        limit: 100,
        after: 'c-0',
      });
    });
  });

  describe('get', () => {
    it('should return a notification of the user', async () => {
      // given
      repository.byIdForUser.mockResolvedValue(row);

      // when
      const notification = await service.get(USER_ID, NOTIFICATION_ID);

      // then
      expect(repository.byIdForUser).toHaveBeenCalledWith(
        NOTIFICATION_ID,
        USER_ID,
      );
      expect(notification).toBe(row);
    });

    it('should reject an unknown notification', async () => {
      // given
      repository.byIdForUser.mockResolvedValue(undefined);

      // when & then
      await expect(service.get(USER_ID, NOTIFICATION_ID)).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    });
  });

  describe('markRead', () => {
    it('should mark the notification read', async () => {
      // given
      const read = { ...row, readAt: FIXED_DATE };
      repository.markRead.mockResolvedValue(read);

      // when
      const notification = await service.markRead(USER_ID, NOTIFICATION_ID);

      // then
      expect(repository.markRead).toHaveBeenCalledWith(
        NOTIFICATION_ID,
        USER_ID,
      );
      expect(notification).toBe(read);
    });

    it('should reject an unknown notification', async () => {
      // given
      repository.markRead.mockResolvedValue(undefined);

      // when & then
      await expect(
        service.markRead(USER_ID, NOTIFICATION_ID),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('markAllRead', () => {
    it('should mark every kind read', async () => {
      // given
      repository.markAllRead.mockResolvedValue(3);

      // when
      const count = await service.markAllRead(USER_ID, []);

      // then
      expect(repository.markAllRead).toHaveBeenCalledWith(USER_ID, [
        'ORDER_STATUS',
        'PAYMENT',
        'STOCK',
      ]);
      expect(count).toBe(3);
    });

    it('should pass the requested kinds through', async () => {
      // given
      repository.markAllRead.mockResolvedValue(0);

      // when
      await service.markAllRead(USER_ID, ['PAYMENT']);

      // then
      expect(repository.markAllRead).toHaveBeenCalledWith(USER_ID, ['PAYMENT']);
    });
  });

  describe('receiveInTransaction', () => {
    it('should store the notification in the running transaction', async () => {
      // given
      repository.insert.mockResolvedValue(row);

      // when
      const notification = await service.receiveInTransaction(
        {
          user_id: USER_ID,
          type: 'PAYMENT',
          title: 'Payment received',
          body: 'Payment for order 42 received.',
        },
        'event-1',
        tx,
      );

      // then
      expect(repository.insert).toHaveBeenCalledWith(
        {
          userId: USER_ID,
          orderId: null,
          sourceEventId: 'event-1',
          type: 'PAYMENT',
          title: 'Payment received',
          body: 'Payment for order 42 received.',
          payload: {},
        },
        tx,
      );
      expect(notification).toBe(row);
    });

    it('should normalize the order and keep the payload', async () => {
      // given
      repository.insert.mockResolvedValue(row);

      // when
      await service.receiveInTransaction(
        {
          user_id: USER_ID.toUpperCase(),
          order_id: ORDER_ID.toUpperCase(),
          type: 'ORDER_STATUS',
          title: 'Order confirmed',
          body: 'Your order has been confirmed.',
          payload: { status: 'CONFIRMED' },
        },
        'event-2',
        tx,
      );

      // then
      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          orderId: ORDER_ID,
          payload: { status: 'CONFIRMED' },
        }),
        tx,
      );
    });

    it.each([
      { why: 'the user id is not a uuid', overrides: { user_id: 'nope' } },
      { why: 'the order id is not a uuid', overrides: { order_id: 'nope' } },
      { why: 'the type is unknown', overrides: { type: 'SPAM' } },
      { why: 'the title is blank', overrides: { title: '   ' } },
      { why: 'the title is too long', overrides: { title: 'a'.repeat(201) } },
      { why: 'the body is blank', overrides: { body: '   ' } },
      { why: 'the body is too long', overrides: { body: 'a'.repeat(2001) } },
    ])('should reject when $why', async ({ overrides }) => {
      // when & then
      await expect(
        service.receiveInTransaction(
          {
            user_id: USER_ID,
            type: 'ORDER_STATUS',
            title: 'Order confirmed',
            body: 'Your order has been confirmed.',
            ...overrides,
          } as Parameters<typeof service.receiveInTransaction>[0],
          'event-1',
          tx,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('should reject a missing event id', async () => {
      // when & then
      await expect(
        service.receiveInTransaction(
          {
            user_id: USER_ID,
            type: 'ORDER_STATUS',
            title: 'Order confirmed',
            body: 'Your order has been confirmed.',
          },
          '',
          tx,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
