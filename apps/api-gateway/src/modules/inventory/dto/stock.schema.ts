import { z } from 'zod';

export const setStockSchema = z.object({
  inStock: z.number().int().nonnegative(),
});

export type SetStockDto = z.infer<typeof setStockSchema>;
