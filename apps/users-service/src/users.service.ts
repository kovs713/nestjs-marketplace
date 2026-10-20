import { Injectable, Logger } from '@nestjs/common';
import { hash, verify } from 'argon2';

import { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';
import { DomainError } from '@app/common/errors/domain-error.js';

import { User } from './database/users.schema.js';
import { RefreshSession } from './domain/refresh-session.js';
import { TokenPair } from './dto/tokens-result.dto.js';
import { toUserResultDto, type UserResultDto } from './dto/user-result.dto.js';
import { LoginDto, RegisterDto } from './schemas/login-register.schema.js';
import { TokensService } from './tokens.service.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repository: UsersRepository,
    private readonly tokens: TokensService,
  ) {}

  async register(dto: RegisterDto): Promise<UserResultDto> {
    const passwordHash = await hash(dto.password);

    const user = await this.repository.insertUser({
      login: dto.login,
      email: dto.email,
      role: dto.role,
      passwordHash,
    });

    this.logger.log({
      msg: 'user registered',
      userId: user.id,
      role: user.role,
    });

    return toUserResultDto(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.repository.userByLogin(dto.login);

    if (!user || user.status !== 'active' || user.deletedAt) {
      this.logger.warn({ msg: 'login rejected', login: dto.login });

      throw new DomainError('UNAUTHENTICATED', 'invalid credentials');
    }

    if (!(await verify(user.passwordHash, dto.password))) {
      this.logger.warn({ msg: 'login rejected', login: dto.login });

      throw new DomainError('UNAUTHENTICATED', 'invalid credentials');
    }

    this.logger.log({ msg: 'user logged in', userId: user.id });

    return this.issuePair(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: { sub: string };

    try {
      claims = await this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'invalid refresh token');
    }

    const session = await this.repository.refreshSessionByHash(
      this.tokens.hash(refreshToken),
    );
    if (!session) {
      throw new DomainError(
        'UNAUTHENTICATED',
        'refresh token revoked or expired',
      );
    }

    session.assertUsable(UniqueId.from(claims.sub));

    const user = await this.repository.userById(claims.sub);
    if (!user || user.status !== 'active' || user.deletedAt) {
      throw new DomainError('UNAUTHENTICATED', 'user is not active');
    }

    const pair = await this.issuePair(user, session);

    this.logger.debug({ msg: 'refresh token rotated', userId: user.id });

    return pair;
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.tokens.hash(refreshToken);

    const session = await this.repository.refreshSessionByHash(hash);
    if (!session) {
      return;
    }

    session.revoke();
    await this.repository.revokeRefreshSession(hash, session.state.revokedAt!);

    this.logger.debug({
      msg: 'refresh session revoked',
      userId: session.state.userId.value,
    });
  }

  async getMe(userId: string): Promise<UserResultDto> {
    const user = await this.repository.userById(userId);

    if (!user) {
      throw new DomainError('NOT_FOUND', 'user not found');
    }

    return toUserResultDto(user);
  }

  private async issuePair(
    user: User,
    previous?: RefreshSession,
  ): Promise<TokenPair> {
    const { id, login, role } = user;

    const userId = UniqueId.from(id);
    const issued = await this.tokens.issue({ id, login, role });

    const next = RefreshSession.issue({
      userId,
      tokenHash: this.tokens.hash(issued.refreshToken),
      expiresAt: issued.refreshExpiresAt,
    });

    if (previous) {
      previous.consume(userId);
      if (!(await this.repository.rotateRefreshSession(previous, next))) {
        throw new DomainError(
          'UNAUTHENTICATED',
          'refresh token revoked or expired',
        );
      }
    } else await this.repository.insertRefreshSession(next);

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
    };
  }
}
