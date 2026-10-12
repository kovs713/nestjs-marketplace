import { Pool, PoolConfig } from 'pg';

export function createPgPool(
  connectionString: string,
  overrides?: Partial<PoolConfig>,
): Pool {
  return new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
    ...overrides,
  });
}
