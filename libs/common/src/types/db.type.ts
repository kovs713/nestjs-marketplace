import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type DbTransaction = Parameters<
  Parameters<NodePgDatabase['transaction']>[0]
>[0];

export type DbClient = NodePgDatabase | DbTransaction;
