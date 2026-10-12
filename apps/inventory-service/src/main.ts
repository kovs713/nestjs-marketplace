import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';

import { PROTO_ROOT } from '@app/contracts';
import { protobufPackage as inventory_v1 } from '@app/contracts/generated/inventory/v1/inventory.js';
import {
  KAFKA_CONFIG_KEY,
  kafkaConsumerOptions,
  type KafkaConfig,
} from '@app/kafka';

import { InventoryServiceModule } from './inventory.module.js';

async function bootstrap() {
  const app = await NestFactory.create(InventoryServiceModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.enableShutdownHooks();

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: inventory_v1,
      protoPath: join(PROTO_ROOT, 'inventory/v1/inventory.proto'),
      url: `0.0.0.0:${config.getOrThrow('GRPC_PORT')}`,
      loader: {
        includeDirs: [PROTO_ROOT],
        longs: Number,
        defaults: true,
      },
    },
  });

  app.connectMicroservice(
    kafkaConsumerOptions(
      config.getOrThrow<KafkaConfig>(KAFKA_CONFIG_KEY),
      'inventory',
    ),
  );

  await app.startAllMicroservices();
  await app.listen(config.getOrThrow<number>('app.port'));

  logger.log(
    `inventory-service started (http=:${config.getOrThrow<number>('app.port')} grpc=:${config.getOrThrow('GRPC_PORT')})`,
  );
}
await bootstrap();
