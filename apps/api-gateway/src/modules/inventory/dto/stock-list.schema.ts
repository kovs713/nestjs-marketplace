import { z } from 'zod';

import { pageSchema } from '@app/common';

export const stockListSchema = pageSchema.extend({
  productIds: z
    .union([z.uuid(), z.array(z.uuid()).min(1).max(100)])
    .transform((value) => (typeof value === 'string' ? [value] : value))
    .optional(),
});

export type StockListDto = z.infer<typeof stockListSchema>;
