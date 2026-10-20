export const DOMAIN_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'FAILED_PRECONDITION',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'UNAVAILABLE',
  'INTERNAL',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return (
    typeof value === 'string' &&
    (DOMAIN_ERROR_CODES as readonly string[]).includes(value)
  );
}

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
