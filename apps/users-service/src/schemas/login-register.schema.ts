import { z } from 'zod';

import { Role } from '@app/contracts/generated/users/v1/users.js';

const login = z.string().min(1).max(20);
const password = z.string().min(1).max(1024);

export const loginSchema = z.object({ login, password });

export type LoginDto = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  login,
  email: z.string().min(1).max(320),
  password: password.min(8),
  role: z.union([
    z.literal(Role.ROLE_BUYER).transform(() => 'buyer' as const),
    z.literal(Role.ROLE_SELLER).transform(() => 'seller' as const),
  ]),
});

export type RegisterDto = z.infer<typeof registerSchema>;
