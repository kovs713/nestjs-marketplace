import { z } from 'zod';

export const sessionSchema = z.object({
  refreshToken: z.string().min(1).max(8192),
});
