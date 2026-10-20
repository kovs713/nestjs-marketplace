import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { ApiGatewayModule } from './api-gateway.module.js';
import { GrpcExceptionFilter } from './filters/grpc-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(ApiGatewayModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.enableShutdownHooks();
  app.useLogger(logger);
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new GrpcExceptionFilter());

  await app.listen(config.getOrThrow<number>('app.port'));

  logger.log(
    `api-gateway started (http=:${config.getOrThrow<number>('app.port')})`,
  );
}
await bootstrap();
