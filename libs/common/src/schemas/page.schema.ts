import { z } from 'zod';

import { decodeCursor } from '@app/common';

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z
    .string()
    .max(100)
    .refine(
      (value) => !value || z.uuid().safeParse(decodeCursor(value)).success,
      'invalid page cursor',
    )
    .optional(),
});
