import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { validateConfig } from '@app/common/config/validate-config.js';

export type S3Config = {
  host: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucketName: string;
  region: string;
  useSsl: boolean;

  presignedTtl?: number;
};

export const s3EnvSchema = z.object({
  S3_HOST: z.string(),
  S3_PORT: z.coerce.number().int(),
  S3_USERNAME: z.string(),
  S3_PASSWORD: z.string(),
  S3_BUCKET_NAME: z.string(),
  S3_REGION: z.string(),
  S3_USE_SSL: z.stringbool(),
  S3_PRESIGNED_TTL: z.coerce
    .number()
    .int()
    .positive()
    .max(604800)
    .default(3600),
});

export const S3_CONFIG_KEY = 's3';

export default registerAs<S3Config>(S3_CONFIG_KEY, () => {
  const validatedConfig = validateConfig(process.env, s3EnvSchema);

  return {
    host: validatedConfig.S3_HOST,
    port: validatedConfig.S3_PORT,
    accessKey: validatedConfig.S3_USERNAME,
    secretKey: validatedConfig.S3_PASSWORD,
    bucketName: validatedConfig.S3_BUCKET_NAME,
    region: validatedConfig.S3_REGION,
    useSsl: validatedConfig.S3_USE_SSL,
    presignedTtl: validatedConfig.S3_PRESIGNED_TTL,
  };
});
