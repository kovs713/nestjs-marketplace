import type { User } from '../database/users.schema.js';

export type UserResultDto = Omit<User, 'passwordHash'>;

export function toUserResultDto(user: User): UserResultDto {
  const { passwordHash: _, ...result } = user;
  return result;
}
