import { z } from 'zod';

export const addToCartSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().positive(),
});

export type AddToCartDto = z.infer<typeof addToCartSchema>;
