import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export type Notification = typeof notifications.$inferSelect;
export type NotificationKind = Notification['type'];

export const notificationType = pgEnum('notification_type', [
  'ORDER_STATUS',
  'PAYMENT',
  'STOCK',
]);
export const notificationKinds = notificationType.enumValues;

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id').notNull(),
    orderId: uuid('order_id'),
    sourceEventId: text('source_event_id').notNull(),

    type: notificationType('type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: varchar('body', { length: 2000 }).notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('notifications_source_event_id').on(table.sourceEventId),

    index('notifications_user_created').on(table.userId, table.id),
    index('notifications_user_unread')
      .on(table.userId, table.id)
      .where(sql`${table.readAt} is null`),
  ],
);
