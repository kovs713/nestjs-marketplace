import { status } from '@grpc/grpc-js';
import { Catch, Logger, type RpcExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { throwError } from 'rxjs';
import { z } from 'zod';

import { DomainError } from '../errors/domain-error.js';

@Catch()
export class GrpcExceptionFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger(GrpcExceptionFilter.name);

  catch(error: unknown) {
    if (error instanceof RpcException) {
      return throwError(() => error.getError());
    }

    if (error instanceof z.ZodError) {
      return throwError(() => ({
        code: status.INVALID_ARGUMENT,
        message: 'invalid request',
      }));
    }

    if (error instanceof DomainError) {
      this.logger.debug({ code: error.code, msg: error.message });

      return throwError(() => ({
        code: status[error.code],
        message: error.message,
      }));
    }

    this.logger.error({ err: error, msg: 'unhandled gRPC error' });

    return throwError(() => ({
      code: status.INTERNAL,
      message: 'internal error',
    }));
  }
}
