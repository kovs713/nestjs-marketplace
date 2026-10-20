import { status as grpcStatus } from '@grpc/grpc-js';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { DomainError, DomainErrorHttpFilter } from '@app/common';

const GRPC_TO_HTTP: Record<number, number> = {
  [grpcStatus.INVALID_ARGUMENT]: HttpStatus.BAD_REQUEST,
  [grpcStatus.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [grpcStatus.PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [grpcStatus.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [grpcStatus.ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [grpcStatus.FAILED_PRECONDITION]: HttpStatus.CONFLICT,
  [grpcStatus.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [grpcStatus.DEADLINE_EXCEEDED]: HttpStatus.GATEWAY_TIMEOUT,
};

/** Grpc exceptions translated to Http format */
@Catch()
export class GrpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GrpcExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof DomainError) {
      return new DomainErrorHttpFilter().catch(exception, host);
    }

    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({ message: exception.message });
      return;
    }

    const err = exception as { code?: number; details?: string };
    const code = err?.code;
    if (typeof code === 'number' && code in GRPC_TO_HTTP) {
      res.status(GRPC_TO_HTTP[code]).json({ message: err.details ?? 'error' });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'internal server error',
    });
  }
}
