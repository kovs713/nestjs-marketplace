import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';

import { PROTO_ROOT } from '@app/contracts';
import { protobufPackage as users_v1 } from '@app/contracts/generated/users/v1/users.js';

import { UsersModule } from './users.module.js';

async function bootstrap() {
  const app = await NestFactory.create(UsersModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.enableShutdownHooks();

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: users_v1,
      protoPath: join(PROTO_ROOT, 'users/v1/users.proto'),
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
    `users-service started (http=:${config.getOrThrow<number>('app.port')} grpc=:${config.getOrThrow('GRPC_PORT')})`,
  );
}
await bootstrap();
