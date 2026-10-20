import { PostgreSqlContainer } from '@testcontainers/postgresql';

const DATABASE_URLS = [
  'ORDERS_TEST_DATABASE_URL',
  'INVENTORY_TEST_DATABASE_URL',
  'PAYMENT_TEST_DATABASE_URL',
];

export default async function setup() {
  if (DATABASE_URLS.every((name) => process.env[name])) return;

  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const url = container.getConnectionUri();
  for (const name of DATABASE_URLS) process.env[name] ??= url;

  return () => container.stop();
}
