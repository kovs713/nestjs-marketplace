import { z } from 'zod';

import { pageSchema } from '@app/common';

export const querySchema = pageSchema.extend({
  types: z
    .string()
    .optional()
    .transform((value) =>
      value ? value.split(',').map((item) => Number(item)) : [],
    )
    .pipe(z.array(z.number().int().min(1).max(3))),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type QueryDto = z.infer<typeof querySchema>;
