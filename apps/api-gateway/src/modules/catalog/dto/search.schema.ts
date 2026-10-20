import { z } from 'zod';

import { pageSchema } from '@app/common';

export const searchSchema = pageSchema.extend({
  q: z.string().trim().min(1).max(200),
  categoryId: z.uuid().optional(),
});

export type SearchDto = z.infer<typeof searchSchema>;
