import { Test } from '@nestjs/testing';

import type { S3Config } from './s3.config.js';
import { S3_OPTIONS } from './s3.constants.js';
import { S3Module } from './s3.module.js';
import { S3Service } from './s3.service.js';

const S3_KEYS = [
  'S3_HOST',
  'S3_PORT',
  'S3_USERNAME',
  'S3_PASSWORD',
  'S3_BUCKET_NAME',
  'S3_REGION',
  'S3_USE_SSL',
];

const S3_ENV: Record<string, string> = {
  S3_HOST: 'minio',
  S3_PORT: '9000',
  S3_USERNAME: 'minioadmin',
  S3_PASSWORD: 'minioadmin',
  S3_BUCKET_NAME: 'marketplace',
  S3_REGION: 'us-east-1',
  S3_USE_SSL: 'false',
};

const setS3Env = (env: Record<string, string>) => {
  for (const key of S3_KEYS) delete process.env[key];
  Object.assign(process.env, env);
};

describe('S3Module', () => {
  afterEach(() => setS3Env({}));

  it('get credentials from service environment', async () => {
    // given
    setS3Env(S3_ENV);

    // when
    const module = await Test.createTestingModule({
      imports: [S3Module],
    }).compile();

    // then
    expect(module.get(S3Service)).toBeDefined();
    expect(module.get<S3Config>(S3_OPTIONS)).toMatchObject({
      host: 'minio',
      port: 9000,
      bucketName: 'marketplace',
      useSsl: false,
    });
  });

  it('shutdown if S3_* creds not passed', async () => {
    // given
    setS3Env({});

    // when & then
    await expect(
      Test.createTestingModule({ imports: [S3Module] }).compile(),
    ).rejects.toThrow(/S3_HOST/);
  });
});
