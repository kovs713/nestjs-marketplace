import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { UploadFileDto } from './dto/upload-file.dto.js';
import { handleS3Error } from './exceptions/handle-errors.util.js';
import type { S3Config } from './s3.config.js';
import { S3_CLIENT, S3_OPTIONS } from './s3.constants.js';

@Injectable()
export class S3Service {
  private readonly logger: Logger = new Logger(S3Service.name);

  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(S3_OPTIONS) private readonly s3Config: S3Config,
  ) {}

  async uploadFile(dto: UploadFileDto): Promise<void> {
    const { file, folder, name } = dto;
    const key = `${folder}/${name}`;

    const command = new PutObjectCommand({
      Bucket: this.s3Config.bucketName,
      Key: key,
      Body: file.buffer,
      ACL: 'public-read',
      ContentType: file.mimetype,
    });

    this.logger.log(`Uploading file to: ${key}`);

    try {
      await this.s3Client.send(command);

      this.logger.log(`Succesfully uploaded: ${key}`);
    } catch (error: unknown) {
      handleS3Error(error, 'upload file', this.logger);
    }
  }

  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.s3Config.bucketName,
      Key: key,
    });

    this.logger.log(`Deleting file: ${key}`);

    try {
      await this.s3Client.send(command);

      this.logger.log(`Succesfully deleted: ${key}`);
    } catch (error: unknown) {
      handleS3Error(error, 'delete file', this.logger);
    }
  }

  async readFile(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.s3Config.bucketName,
      Key: key,
    });

    this.logger.log(`Getting file: ${key}`);

    try {
      const presignedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: this.s3Config.presignedTtl,
      });

      this.logger.log(`Succesfully get presigned url: ${key}`);

      return presignedUrl;
    } catch (error: unknown) {
      handleS3Error(error, 'get presigned url', this.logger);
    }
  }
}
