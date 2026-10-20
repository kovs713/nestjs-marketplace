import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { DbTransaction } from '@app/common';
import { decodeCursor, DomainError, encodeCursor } from '@app/common';

import {
  notifications,
  type Notification,
  type NotificationKind,
} from '../database/notification.schema.js';

@Injectable()
export class NotificationRepository {
  private readonly logger = new Logger(NotificationRepository.name);

  constructor(
    @InjectDrizzle()
    private readonly db: NodePgDatabase,
  ) {}

  async insert(
    notification: typeof notifications.$inferInsert,
    tx: DbTransaction,
  ) {
    const [inserted] = await tx
      .insert(notifications)
      .values(notification)
      .onConflictDoNothing({ target: notifications.sourceEventId })
      .returning();
    if (inserted) return inserted;
    const [existing] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.sourceEventId, notification.sourceEventId))
      .limit(1);
    if (!existing)
      throw new DomainError('INTERNAL', 'notification event was not persisted');
    this.logger.debug({
      msg: 'duplicate notification event reused',
      eventId: notification.sourceEventId,
      notificationId: existing.id,
    });
    return existing;
  }

  async byIdForUser(
    id: string,
    userId: string,
  ): Promise<Notification | undefined> {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1);
    return row;
  }

  async bySourceEventId(eventId: string): Promise<Notification | undefined> {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.sourceEventId, eventId))
      .limit(1);
    return row;
  }

  async list(filter: {
    userId: string;
    types: NotificationKind[];
    unreadOnly: boolean;
    limit: number;
    after?: string;
  }) {
    const after = filter.after ? decodeCursor(filter.after) : undefined;
    if (filter.after && !after)
      throw new DomainError('INVALID_ARGUMENT', 'invalid notification cursor');
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, filter.userId),
          inArray(notifications.type, filter.types),
          filter.unreadOnly ? isNull(notifications.readAt) : undefined,
          after ? lt(notifications.id, after) : undefined,
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(filter.limit + 1);
    const hasNext = rows.length > filter.limit;
    const selected = rows.slice(0, filter.limit);
    return {
      items: selected,
      nextCursor:
        hasNext && selected.length
          ? encodeCursor(selected[selected.length - 1]!.id)
          : '',
    };
  }

  async markRead(
    id: string,
    userId: string,
  ): Promise<Notification | undefined> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning();
    return row ?? this.byIdForUser(id, userId);
  }

  async markAllRead(userId: string, types: NotificationKind[]) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notifications.userId, userId),
          inArray(notifications.type, types),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  }
}
