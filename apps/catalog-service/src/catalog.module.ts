import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  appConfig,
  AppLoggerModule,
  createPgPool,
  DATABASE_CONFIG_KEY,
  databaseConfig,
  type DatabaseConfig,
  HealthModule,
  OutboxKafkaModule,
} from '@app/common';
import { kafkaConfig } from '@app/kafka';
import { REDIS_CLIENT, redisConfig, RedisModule } from '@app/redis';

import type { Redis } from 'ioredis';
import { CatalogCommands } from './application/catalog.commands.js';
import { CatalogQueries } from './application/catalog.queries.js';
import { StockEventsConsumer } from './infrastructure/catalog.consumer.js';
import { CatalogController } from './infrastructure/catalog.controller.js';
import { CatalogRepository } from './infrastructure/catalog.repository.js';

@Module({
  imports: [
    AppLoggerModule.register('catalog-service'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`apps/catalog-service/.env`],
      load: [appConfig, databaseConfig, kafkaConfig, redisConfig],
    }),
    HealthModule,
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        db: drizzle({
          client: createPgPool(
            config.getOrThrow<DatabaseConfig>(DATABASE_CONFIG_KEY).url,
          ),
        }),
      }),
    }),
    RedisModule.forRootAsync(),
    OutboxKafkaModule(),
  ],
  controllers: [CatalogController, StockEventsConsumer],
  providers: [
    CatalogCommands,
    CatalogRepository,
    {
      provide: CatalogQueries,
      inject: [CatalogRepository, REDIS_CLIENT],
      useFactory: (repository: CatalogRepository, redis: Redis) =>
        new CatalogQueries(repository, redis),
    },
  ],
})
export class CatalogServiceModule {}
