import { NestFactory } from '@nestjs/core';

import { CatalogServiceModule } from './catalog-service.module.js';

async function bootstrap() {
  const app = await NestFactory.create(CatalogServiceModule);
  await app.listen(process.env.port ?? 3000);
}
await bootstrap();
