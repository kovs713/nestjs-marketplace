import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { DomainErrorHttpFilter } from '@app/common';
import {
  KAFKA_CONFIG_KEY,
  kafkaConsumerOptions,
  type KafkaConfig,
} from '@app/kafka';

import { NotificationServiceModule } from './notification/notification.module.js';
import { RedisIoAdapter } from './redis-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(NotificationServiceModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis(config.getOrThrow<string>('REDIS_URL'));

  app.useLogger(logger);
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new DomainErrorHttpFilter());
  app.useWebSocketAdapter(adapter);
  app.enableShutdownHooks();

  app.connectMicroservice(
    kafkaConsumerOptions(
      config.getOrThrow<KafkaConfig>(KAFKA_CONFIG_KEY),
      'notification',
    ),
  );

  await app.startAllMicroservices();
  await app.listen(config.getOrThrow<number>('app.port'));

  logger.log(
    `notification-service started (http=:${config.getOrThrow<number>('app.port')})`,
  );
}
await bootstrap();
