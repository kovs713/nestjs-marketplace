import { z } from 'zod';

export const registerSchema = z.object({
  login: z.string().min(1, 'login cannot be empty'),
  email: z.string().min(1, 'email cannot be empty'),
  password: z.string().min(8, 'password must be at least 8 characters long'),
  role: z.enum(['buyer', 'seller']).optional(),
});

export type RegisterDto = z.infer<typeof registerSchema>;
