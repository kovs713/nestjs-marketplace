import { S3ServiceException } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

export function handleS3Error(
  error: unknown,
  operation: string,
  logger: Logger,
): never {
  const errorMessage = error instanceof Error ? error.message : String(error);

  logger.error(`S3 ${operation} failed: ${errorMessage}`);

  if (error instanceof S3ServiceException) {
    switch (error.name) {
      case 'NoSuchBucket':
        throw new InternalServerErrorException('S3 bucket misconfigured');

      case 'NoSuchKey':
        throw new NotFoundException('File not found');

      case 'AccessDenied':
        throw new NotFoundException('File not found or acces denied');

      default:
        throw new BadRequestException(
          `Failed to ${operation}: ${errorMessage}`,
        );
    }
  }

  throw new InternalServerErrorException(
    `Unexpected error during ${operation}`,
  );
}
