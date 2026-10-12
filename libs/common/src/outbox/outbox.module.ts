import type { DynamicModule, Provider } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import {
  OutboxModule,
  OutboxStorage,
  type OutboxModuleOptions,
} from '@nestjs/outbox';
import { fromDrizzle, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { KafkaOutboxTransport } from '@app/kafka/kafka.transport.js';

export function OutboxKafkaModule(): DynamicModule {
  const store: Provider = {
    provide: PostgresOutboxStore,
    useFactory: (db: NodePgDatabase, storage: OutboxStorage) =>
      new PostgresOutboxStore({ executor: fromDrizzle(db) }, storage),
    inject: [getDrizzleToken(), OutboxStorage],
  };

  const module = OutboxModule.forRootAsync({
    inject: [KafkaOutboxTransport],
    useFactory: (kafka: KafkaOutboxTransport): OutboxModuleOptions => ({
      transports: { kafka },
      route: () => 'kafka',
      relay: { pollInterval: '1s', batchSize: 100, lease: '30s' },
      retry: {
        attempts: 10,
        backoff: { delay: '1s', factor: 2, maxDelay: '5m' },
      },
    }),
  });

  return {
    ...module,
    providers: [...(module.providers ?? []), store, KafkaOutboxTransport],
  };
}
