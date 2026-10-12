import { z } from 'zod';

export const updateProductSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  priceMinor: z.number().int().nonnegative().optional(),
  imageUrl: z.string().optional(),
  categoryIds: z.array(z.string()).optional(),
});

export type UpdateProductDto = z.infer<typeof updateProductSchema>;
