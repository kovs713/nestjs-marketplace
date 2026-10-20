import { DomainError } from '../errors/domain-error.js';
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from './pg-error.util.js';

export function translate(error: unknown): never {
  if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
    throw new DomainError('NOT_FOUND', 'unknown category');
  }

  if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
    throw new DomainError('ALREADY_EXISTS', 'unique key already taken');
  }

  throw error;
}
