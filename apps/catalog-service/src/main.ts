import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';

import { PROTO_ROOT } from '@app/contracts';
import { protobufPackage as catalog_v1 } from '@app/contracts/generated/catalog/v1/catalog.js';
import {
  KAFKA_CONFIG_KEY,
  kafkaConsumerOptions,
  type KafkaConfig,
} from '@app/kafka';

import { CatalogServiceModule } from './catalog.module.js';

async function bootstrap() {
  const app = await NestFactory.create(CatalogServiceModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.enableShutdownHooks();

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: catalog_v1,
      protoPath: join(PROTO_ROOT, 'catalog/v1/catalog.proto'),
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
      'catalog',
    ),
  );

  await app.startAllMicroservices();
  await app.listen(config.getOrThrow<number>('app.port'));

  logger.log(
    `catalog-service started (http=:${config.getOrThrow<number>('app.port')} grpc=:${config.getOrThrow('GRPC_PORT')})`,
  );
}
await bootstrap();
