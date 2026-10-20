import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';

import type {
  GetMeRequest,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterRequest,
  TokenPair,
  User,
  UsersServiceClient,
} from '@app/contracts/generated/users/v1/users.js';
import { USERS_SERVICE_NAME } from '@app/contracts/generated/users/v1/users.js';

import { GrpcResilience } from '../../grpc/grpc-resilience.js';
import { USERS_CLIENT } from './users.token.js';

@Injectable()
export class UsersClient implements OnModuleInit {
  private service!: UsersServiceClient;

  constructor(
    @Inject(USERS_CLIENT)
    private readonly client: ClientGrpc,
    private readonly resilience: GrpcResilience,
  ) {}

  onModuleInit(): void {
    this.service =
      this.client.getService<UsersServiceClient>(USERS_SERVICE_NAME);
  }

  async getMe(request: GetMeRequest): Promise<User> {
    return this.resilience.call(() => this.service.getMe(request), {
      source: 'users.me',
      retryable: true,
    });
  }

  async register(request: RegisterRequest): Promise<User> {
    return this.resilience.call(() => this.service.register(request), {
      source: 'auth.register',
    });
  }

  async login(request: LoginRequest): Promise<TokenPair> {
    return this.resilience.call(() => this.service.login(request), {
      source: 'auth.login',
    });
  }

  async refresh(request: RefreshRequest): Promise<TokenPair> {
    return this.resilience.call(() => this.service.refresh(request), {
      source: 'auth.refresh',
    });
  }

  async logout(request: LogoutRequest): Promise<void> {
    await this.resilience.call(() => this.service.logout(request), {
      source: 'auth.logout',
    });
  }
}
