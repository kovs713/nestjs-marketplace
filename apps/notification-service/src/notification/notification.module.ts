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
import { AppJwtModule, tokenConfig } from '@app/jwt';
import { kafkaConfig } from '@app/kafka';
import { redisConfig } from '@app/redis';

import { NotificationRepository } from '../repositories/notification.repository.js';
import { NotificationConsumer } from './notification.consumer.js';
import { NotificationHttpController } from './notification.controller.js';
import { NotificationGateway } from './notification.gateway.js';
import { NotificationService } from './notification.service.js';

@Module({
  imports: [
    AppLoggerModule.register('notification-service'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/notification-service/.env'],
      load: [appConfig, databaseConfig, kafkaConfig, redisConfig, tokenConfig],
    }),
    HealthModule,
    AppJwtModule,
    OutboxKafkaModule(),
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
  ],
  controllers: [NotificationHttpController, NotificationConsumer],
  providers: [NotificationRepository, NotificationGateway, NotificationService],
})
export class NotificationServiceModule {}
