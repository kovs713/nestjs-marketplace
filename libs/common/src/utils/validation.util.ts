import { z } from 'zod';

import { DomainError } from '../errors/domain-error.js';

const uuidSchema = z.uuid();

export function validateUuid<T extends unknown>(value: T): T {
  if (!uuidSchema.safeParse(value).success) {
    throw new DomainError('INVALID_ARGUMENT', 'invalid UUID');
  }
  return value;
}

export function validateIdempotencyKey(
  value: unknown,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new DomainError('INVALID_ARGUMENT', 'invalid idempotency_key');
  }
}
