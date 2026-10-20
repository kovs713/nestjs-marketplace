import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { validateConfig } from '@app/common/config/validate-config.js';

export type JwtConfig = {
  secret: string;
  accessTtl: string;
  refreshTtl: string;
};

export const jwtEnvSchema = z.object({
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_ACCESS_TTL: z.string().regex(/^\d+[smhd]$/, {
    message: 'JWT_ACCESS_TTL must look like 15m, 1h, 7d',
  }),
  JWT_REFRESH_TTL: z.string().regex(/^\d+[smhd]$/, {
    message: 'JWT_REFRESH_TTL must look like 15m, 1h, 30d',
  }),
});

export const TOKEN_CONFIG_KEY = 'token';

export default registerAs<JwtConfig>(TOKEN_CONFIG_KEY, () => {
  const env = validateConfig(process.env, jwtEnvSchema);
  return {
    secret: env.JWT_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  };
});
