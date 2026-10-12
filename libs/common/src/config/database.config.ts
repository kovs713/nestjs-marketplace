import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { validateConfig } from './validate-config.js';

export type DatabaseConfig = {
  url: string;
};

export const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .regex(/^postgres(ql)?:\/\//, {
      message: 'DATABASE_URL must be a postgres:// connection string',
    }),
});

export const DATABASE_CONFIG_KEY = 'database';

export default registerAs<DatabaseConfig>(DATABASE_CONFIG_KEY, () => {
  const env = validateConfig(process.env, databaseEnvSchema);
  return { url: env.DATABASE_URL };
});
