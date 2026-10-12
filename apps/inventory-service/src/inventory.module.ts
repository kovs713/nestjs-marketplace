import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { drizzle } from 'drizzle-orm/node-postgres';
import { join } from 'node:path';

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
import { PROTO_ROOT } from '@app/contracts';
import { CATALOG_V1_PACKAGE_NAME } from '@app/contracts/generated/catalog/v1/catalog.js';
import { kafkaConfig } from '@app/kafka';
import { redisConfig } from '@app/redis';

import { CatalogClient } from './catalog/catalog.client.js';
import { CATALOG_CLIENT, catalogConfig } from './catalog/catalog.config.js';
import { ReservationExpiryScheduler } from './reservation/reservation-expiry.scheduler.js';
import { ReservationController } from './reservation/reservation.controller.js';
import { ReservationRepository } from './reservation/reservation.repository.js';
import { ReservationService } from './reservation/reservation.service.js';
import { ProductCreatedConsumer } from './stock/stock.consumer.js';
import { StockController } from './stock/stock.controller.js';
import { StockRepository } from './stock/stock.repository.js';
import { StockService } from './stock/stock.service.js';

@Module({
  imports: [
    AppLoggerModule.register('inventory-service'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/inventory-service/.env'],
      load: [
        appConfig,
        databaseConfig,
        kafkaConfig,
        redisConfig,
        catalogConfig,
      ],
    }),
    HealthModule,
    ClientsModule.registerAsync([
      {
        name: CATALOG_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: CATALOG_V1_PACKAGE_NAME,
            protoPath: join(PROTO_ROOT, 'catalog/v1/catalog.proto'),
            url: config.getOrThrow<string>('catalogClient.url'),
            loader: {
              includeDirs: [PROTO_ROOT],
              longs: Number,
              defaults: true,
            },
          },
        }),
      },
    ]),
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
    OutboxKafkaModule(),
  ],
  controllers: [ProductCreatedConsumer, StockController, ReservationController],
  providers: [
    CatalogClient,

    StockService,
    StockRepository,

    ReservationService,
    ReservationRepository,
    ReservationExpiryScheduler,
  ],
})
export class InventoryServiceModule {}
