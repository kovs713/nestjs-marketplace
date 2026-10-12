import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { validateConfig } from '@app/common';

export const CATALOG_CLIENT = 'INVENTORY_CATALOG_CLIENT';
export const catalogConfig = registerAs('catalogClient', () => {
  const env = validateConfig(
    process.env,
    z.object({
      CATALOG_GRPC_URL: z
        .string()
        .regex(/^[\w.-]+:\d+$/)
        .default('localhost:50052'),
    }),
  );
  return { url: env.CATALOG_GRPC_URL };
});
