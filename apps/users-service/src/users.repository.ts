import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DomainError, PG_UNIQUE_VIOLATION, pgErrorCode } from '@app/common';
import { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';

import { userRefreshTokens } from './database/users-refresh-tokens.schema.js';
import type { NewUser, User } from './database/users.schema.js';
import { users } from './database/users.schema.js';
import { RefreshSession } from './domain/refresh-session.js';

@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async insertUser(user: NewUser): Promise<User> {
    try {
      const [row] = await this.db.insert(users).values(user).returning();

      return row;
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new DomainError('ALREADY_EXISTS', 'login or email already taken');
      }
      throw error;
    }
  }

  async userByLogin(login: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.login, login), isNull(users.deletedAt)))
      .limit(1);

    return row ?? null;
  }

  async userById(id: string): Promise<User | null> {
    return this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  async refreshSessionByHash(tokenHash: string) {
    const [session] = await this.db
      .select()
      .from(userRefreshTokens)
      .where(eq(userRefreshTokens.tokenHash, tokenHash))
      .limit(1);

    return session
      ? RefreshSession.reconstitute({
          userId: UniqueId.from(session.userId),
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt,
          revokedAt: session.revokedAt,
        })
      : null;
  }

  async revokeRefreshSession(
    tokenHash: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.db
      .update(userRefreshTokens)
      .set({ revokedAt })
      .where(
        and(
          eq(userRefreshTokens.tokenHash, tokenHash),
          isNull(userRefreshTokens.revokedAt),
        ),
      );
  }

  async insertRefreshSession(session: RefreshSession): Promise<void> {
    await this.db.insert(userRefreshTokens).values({
      ...session.state,
      userId: session.state.userId.value,
    });
  }

  async rotateRefreshSession(
    previous: RefreshSession,
    next: RefreshSession,
  ): Promise<boolean> {
    const previousRow = {
      ...previous.state,
      userId: previous.state.userId.value,
    };
    const nextRow = {
      ...next.state,
      userId: next.state.userId.value,
    };

    return this.db.transaction(async (tx) => {
      const consumed = await tx
        .update(userRefreshTokens)
        .set({ revokedAt: previousRow.revokedAt })
        .where(
          and(
            eq(userRefreshTokens.tokenHash, previousRow.tokenHash),
            eq(userRefreshTokens.userId, nextRow.userId),
            isNull(userRefreshTokens.revokedAt),
            sql`${userRefreshTokens.expiresAt} > now()`,
          ),
        )
        .returning({ id: userRefreshTokens.id });

      if (!consumed.length) return false;

      await tx.insert(userRefreshTokens).values(nextRow);

      return true;
    });
  }
}
