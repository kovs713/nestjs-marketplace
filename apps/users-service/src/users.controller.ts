import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';

import {
  CurrentActor,
  GrpcExceptionFilter,
  toEpoch,
  type Actor,
} from '@app/common';
import type { Empty } from '@app/contracts/generated/common/v1/common.js';
import type {
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterRequest,
  TokenPair,
  User,
} from '@app/contracts/generated/users/v1/users.js';
import {
  Role,
  USERS_SERVICE_NAME,
  UserStatus,
} from '@app/contracts/generated/users/v1/users.js';

import { UserResultDto } from './dto/user-result.dto.js';
import {
  loginSchema,
  registerSchema,
} from './schemas/login-register.schema.js';
import { sessionSchema } from './schemas/session.schema.js';
import { UsersService } from './users.service.js';

export function toProtoUser(row: UserResultDto): User {
  return {
    id: row.id,
    login: row.login,
    email: row.email,
    role: row.role === 'seller' ? Role.ROLE_SELLER : Role.ROLE_BUYER,
    status:
      row.status === 'blocked'
        ? UserStatus.USER_STATUS_BLOCKED
        : UserStatus.USER_STATUS_ACTIVE,
    createdAt: toEpoch(row.createdAt),
    updatedAt: toEpoch(row.updatedAt),
    deletedAt: row.deletedAt ? toEpoch(row.deletedAt) : undefined,
  };
}

@Controller()
@UseFilters(GrpcExceptionFilter)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @GrpcMethod(USERS_SERVICE_NAME, 'Register')
  async register(data: RegisterRequest): Promise<User> {
    const parsed = registerSchema.parse(data);

    return toProtoUser(await this.usersService.register(parsed));
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'Login')
  async login(data: LoginRequest): Promise<TokenPair> {
    const parsed = loginSchema.parse(data);

    return this.usersService.login(parsed);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'Refresh')
  async refresh(data: RefreshRequest): Promise<TokenPair> {
    const parsed = sessionSchema.parse(data).refreshToken;

    return this.usersService.refresh(parsed);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'Logout')
  async logout(data: LogoutRequest): Promise<Empty> {
    const parsed = sessionSchema.parse(data).refreshToken;

    await this.usersService.logout(parsed);
    return {};
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'GetMe')
  async getMe(@CurrentActor() actor: Actor): Promise<User> {
    return toProtoUser(await this.usersService.getMe(actor.id));
  }
}
