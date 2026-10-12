import { z } from 'zod';

export const adjustStockSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, 'delta must not be zero'),
});

export type AdjustStockDto = z.infer<typeof adjustStockSchema>;
