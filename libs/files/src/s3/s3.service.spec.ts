import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Test, TestingModule } from '@nestjs/testing';
import type { Mock } from 'vitest';

import { generateFileMock } from './__mocks__/generate-file.mock.js';
import type { S3Config } from './s3.config.js';
import { S3_CLIENT, S3_OPTIONS } from './s3.constants.js';
import { S3Service } from './s3.service.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

describe('S3Service', () => {
  let service: S3Service;
  let s3Send: Mock;
  const mockedGetSignedUrl = vi.mocked(getSignedUrl);

  const config = {
    bucketName: 'test-bucket',
    presignedTtl: 3600,
  } as S3Config;

  beforeEach(async () => {
    s3Send = vi.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        { provide: S3_OPTIONS, useValue: config },
        {
          provide: S3_CLIENT,
          useValue: { send: s3Send } satisfies Partial<S3Client>,
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadFile', () => {
    it('puts object under folder/name', async () => {
      // when
      await service.uploadFile({
        file: generateFileMock(),
        folder: 'avatars',
        name: 'a.jpg',
      });

      // then
      expect(s3Send.mock.calls[0][0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: 'avatars/a.jpg',
      });
    });

    it('throws when s3 fails', async () => {
      // given
      s3Send.mockRejectedValueOnce(new Error('boom'));

      // when
      const attempt = service.uploadFile({
        file: generateFileMock(),
        folder: 'avatars',
        name: 'a.jpg',
      });

      // then
      await expect(attempt).rejects.toThrow();
    });
  });

  describe('deleteFile', () => {
    it('deletes by key', async () => {
      // when
      await service.deleteFile('avatars/a.jpg');

      // then
      expect(s3Send.mock.calls[0][0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: 'avatars/a.jpg',
      });
    });
  });

  describe('readFile', () => {
    it('returns presigned url', async () => {
      // given
      mockedGetSignedUrl.mockResolvedValueOnce('https://s3/a.jpg');

      // when
      const result = await service.readFile('avatars/a.jpg');

      // then
      expect(result).toEqual('https://s3/a.jpg');
    });
  });
});
