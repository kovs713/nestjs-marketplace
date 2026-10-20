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
import { INVENTORY_V1_PACKAGE_NAME } from '@app/contracts/generated/inventory/v1/inventory.js';
import { PAYMENT_V1_PACKAGE_NAME } from '@app/contracts/generated/payment/v1/payment.js';
import { kafkaConfig } from '@app/kafka';
import { redisConfig } from '@app/redis';

import { CheckoutConsumer } from './checkout/checkout.consumer.js';
import { CheckoutSaga } from './checkout/checkout.saga.js';
import { RecoveryScheduler } from './checkout/recovery.scheduler.js';
import { DownstreamGrpc } from './clients/downstream.grpc.js';
import {
  CATALOG_CLIENT,
  INVENTORY_CLIENT,
  PAYMENT_CLIENT,
} from './clients/downstream.tokens.js';
import { OrdersController } from './orders.controller.js';
import { OrderRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [
    AppLoggerModule.register('orders-service'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/orders-service/.env'],
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
    OutboxKafkaModule(),
    ClientsModule.registerAsync([
      {
        name: CATALOG_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: CATALOG_V1_PACKAGE_NAME,
            protoPath: join(PROTO_ROOT, 'catalog/v1/catalog.proto'),
            url: config.getOrThrow<string>('CATALOG_GRPC_URL'),
            loader: {
              includeDirs: [PROTO_ROOT],
              longs: Number,
              defaults: true,
            },
          },
        }),
      },

      {
        name: INVENTORY_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: INVENTORY_V1_PACKAGE_NAME,
            protoPath: join(PROTO_ROOT, 'inventory/v1/inventory.proto'),
            url: config.getOrThrow<string>('INVENTORY_GRPC_URL'),
            loader: {
              includeDirs: [PROTO_ROOT],
              longs: Number,
              defaults: true,
            },
          },
        }),
      },

      {
        name: PAYMENT_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: PAYMENT_V1_PACKAGE_NAME,
            protoPath: join(PROTO_ROOT, 'payment/v1/payment.proto'),
            url: config.getOrThrow<string>('PAYMENT_GRPC_URL'),
            loader: {
              includeDirs: [PROTO_ROOT],
              longs: Number,
              defaults: true,
            },
          },
        }),
      },
    ]),
  ],
  controllers: [OrdersController, CheckoutConsumer],
  providers: [
    OrderRepository,
    DownstreamGrpc,
    RecoveryScheduler,
    {
      provide: CheckoutSaga,
      inject: [OrderRepository, DownstreamGrpc],
      useFactory: (repository: OrderRepository, downstream: DownstreamGrpc) =>
        new CheckoutSaga(repository, downstream, downstream),
    },
    {
      provide: OrdersService,
      inject: [OrderRepository, DownstreamGrpc, CheckoutSaga],
      useFactory: (
        repository: OrderRepository,
        downstream: DownstreamGrpc,
        saga: CheckoutSaga,
      ) => new OrdersService(repository, downstream, saga),
    },
  ],
})
export class OrdersServiceModule {}
