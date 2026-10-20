import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { validateConfig } from '@app/common/config/validate-config.js';

export type RedisConfig = {
  url: string;
};

export const redisEnvSchema = z.object({
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .regex(/^rediss?:\/\//, {
      message: 'REDIS_URL must be a redis:// connection string',
    }),
});

export const REDIS_CONFIG_KEY = 'redis';

export default registerAs<RedisConfig>(REDIS_CONFIG_KEY, () => {
  const env = validateConfig(process.env, redisEnvSchema);
  return { url: env.REDIS_URL };
});
