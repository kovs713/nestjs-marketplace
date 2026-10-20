import { z } from 'zod';

import { pageSchema } from '@app/common';

export const categoryListSchema = pageSchema.extend({
  parentId: z.uuid().optional(),
});

export type CategoryListDto = z.infer<typeof categoryListSchema>;
