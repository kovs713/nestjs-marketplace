import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';

import { PROTO_ROOT } from '@app/contracts';

import { PaymentServiceModule } from './payment.module.js';

async function bootstrap() {
  const app = await NestFactory.create(PaymentServiceModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.enableShutdownHooks();

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'payment.v1',
      protoPath: join(PROTO_ROOT, 'payment/v1/payment.proto'),
      url: `0.0.0.0:${config.getOrThrow('GRPC_PORT')}`,
      loader: {
        includeDirs: [PROTO_ROOT],
        longs: Number,
        defaults: true,
      },
    },
  });

  await app.startAllMicroservices();
  await app.listen(config.getOrThrow<number>('app.port'));

  logger.log(
    `payment-service started (http=:${config.getOrThrow<number>('app.port')} grpc=:${config.getOrThrow('GRPC_PORT')})`,
  );
}
await bootstrap();
