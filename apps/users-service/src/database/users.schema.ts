import { isNull, sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['buyer', 'seller']);
export const userStatus = pgEnum('user_status', ['active', 'blocked']);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    login: varchar('login', { length: 20 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRole('role').notNull().default('buyer'),
    status: userStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },

  (t) => [
    uniqueIndex('users_login_active').on(t.login).where(isNull(t.deletedAt)),
    uniqueIndex('users_email_active').on(t.email).where(isNull(t.deletedAt)),
  ],
);
