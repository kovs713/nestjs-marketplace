import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { validateConfig } from './validate-config.js';

export type AppConfig = {
  nodeEnv: string;
  port: number;
  service?: string;
};

export const appEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SERVICE: z.string().optional(),
});

export default registerAs<AppConfig>('app', () => {
  const env = validateConfig(process.env, appEnvSchema);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    service: env.SERVICE,
  };
});
