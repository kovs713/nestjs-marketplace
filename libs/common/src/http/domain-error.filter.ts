import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { DomainError } from '../errors/domain-error.js';

const STATUS: Record<DomainError['code'], number> = {
  INVALID_ARGUMENT: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  ALREADY_EXISTS: HttpStatus.CONFLICT,
  FAILED_PRECONDITION: HttpStatus.CONFLICT,
  PERMISSION_DENIED: HttpStatus.FORBIDDEN,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch(DomainError)
export class DomainErrorHttpFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(STATUS[error.code])
      .json({ message: error.message });
  }
}
