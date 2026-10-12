export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

export const pgErrorCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
};

export const pgErrorConstraint = (err: unknown): string | undefined => {
  const e = err as {
    constraint?: string;
    cause?: { constraint?: string };
  } | null;
  return e?.constraint ?? e?.cause?.constraint;
};
