import { S3 } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import s3Config, { S3_CONFIG_KEY, type S3Config } from './s3.config.js';
import { S3_CLIENT, S3_OPTIONS } from './s3.constants.js';
import { S3Service } from './s3.service.js';

@Module({
  imports: [ConfigModule.forFeature(s3Config)],
  providers: [
    {
      provide: S3_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Config =>
        config.getOrThrow<S3Config>(S3_CONFIG_KEY),
    },
    {
      provide: S3_CLIENT,
      inject: [S3_OPTIONS],
      useFactory: (config: S3Config) => {
        const protocol = config.useSsl ? 'https' : 'http';
        const endpoint = `${protocol}://${config.host}:${config.port}`;

        const s3Client = new S3({
          endpoint: endpoint,
          region: config.region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
          },
        });

        return s3Client;
      },
    },
    S3Service,
  ],
  exports: [S3Service, S3_OPTIONS, S3_CLIENT],
})
export class S3Module {}
