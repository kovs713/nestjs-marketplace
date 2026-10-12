import type { PageInput } from '../application/pagination.js';

// limit 0 / undefined both mean "default", not "one row".
export const clampLimit = (limit?: number) =>
  Math.min(Math.max(limit || 50, 1), 100);

export const encodeCursor = (id: string) =>
  Buffer.from(id, 'utf8').toString('base64');

export const decodeCursor = (cursor?: string): string | undefined => {
  if (!cursor) return undefined;
  const key = Buffer.from(cursor, 'base64').toString('utf8');
  return Buffer.from(key, 'utf8').toString('base64') === cursor
    ? key
    : undefined;
};

export const pageKeyset = (page?: PageInput) => ({
  limit: clampLimit(page?.limit),
  after: decodeCursor(page?.cursor),
});

export const nextCursor = <T extends { id: string }>(
  items: T[],
  limit: number,
) => (items.length < limit ? '' : encodeCursor(items[items.length - 1].id));
