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

import { PaymentController } from './payment.controller.js';
import { PaymentRepository } from './payment.repository.js';
import { PaymentService } from './payment.service.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER } from './providers/payment-provider.js';

@Module({
  imports: [
    AppLoggerModule.register('payment-service'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/payment-service/.env'],
      load: [appConfig, databaseConfig, kafkaConfig],
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
  ],
  controllers: [PaymentController],
  providers: [
    PaymentRepository,
    PaymentService,
    {
      provide: PAYMENT_PROVIDER,
      useClass: MockPaymentProvider,
    },
  ],
})
export class PaymentServiceModule {}
