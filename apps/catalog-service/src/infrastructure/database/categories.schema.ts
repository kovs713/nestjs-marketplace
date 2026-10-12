import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { products } from './products.schema.js';

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export const categories = pgTable(
  'categories',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    parentId: uuid('parent_id'),

    slug: varchar('slug', { length: 100 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('categories_slug').on(t.slug),

    foreignKey({
      name: 'categories_parent_id_categories_id_fkey',
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),

    check(
      'categories_not_self_parent',
      sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`,
    ),
  ],
);

export const productCategories = pgTable(
  'product_categories',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.categoryId] })],
);
