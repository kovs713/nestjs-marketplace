import { z } from 'zod';

export const productListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  sellerId: z.string().optional(),
  categoryId: z.string().optional(),
});

export type ProductsListDto = z.infer<typeof productListSchema>;
