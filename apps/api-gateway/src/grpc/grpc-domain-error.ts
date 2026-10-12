import { status } from '@grpc/grpc-js';

import { DomainError, isDomainErrorCode } from '@app/common';

export function throwDomainError(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
  ) {
    const code = status[error.code];

    if (isDomainErrorCode(code)) {
      const details =
        'details' in error && typeof error.details === 'string'
          ? error.details
          : 'error';

      throw new DomainError(code, details);
    }
  }

  throw error;
}
