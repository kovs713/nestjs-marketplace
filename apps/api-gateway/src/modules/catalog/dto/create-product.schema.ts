import { z } from 'zod';

export const createProductSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  priceMinor: z.number().int().nonnegative(),
  imageUrl: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
  initialStock: z.number().int().nonnegative().default(0),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;
