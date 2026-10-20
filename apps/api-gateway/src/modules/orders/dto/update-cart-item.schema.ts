import { z } from 'zod';

export const updateCartItemSchema = z.object({
  quantity: z.number().int().positive(),
});

export type UpdateCartItemDto = z.infer<typeof updateCartItemSchema>;
