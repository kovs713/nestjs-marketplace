import { z } from 'zod';

export const PRODUCT_CREATED = 'product.created';

export const productCreatedSchema = z.strictObject({
  product_id: z.string().min(1),
  seller_id: z.string().min(1),
  initial_stock: z.number().int().nonnegative(),
});

export type ProductCreated = z.infer<typeof productCreatedSchema>;
