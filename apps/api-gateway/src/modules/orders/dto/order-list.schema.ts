import { z } from 'zod';

export const orderListSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export type OrderListDto = z.infer<typeof orderListSchema>;
