import { z } from 'zod';

export const markAllReadSchema = z
  .object({
    types: z.array(z.number().int().min(1).max(3)).optional(),
  })
  .default({});

export type MarkAllReadDto = z.infer<typeof markAllReadSchema>;
