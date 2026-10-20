import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { DomainError } from '@app/common';
import { AppJwtService } from '@app/jwt';

import { IssuedTokens } from './dto/tokens-result.dto.js';
import { UserResultDto } from './dto/user-result.dto.js';

@Injectable()
export class TokensService {
  constructor(private readonly jwt: AppJwtService) {}

  async issue(
    user: Pick<UserResultDto, 'id' | 'login' | 'role'>,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAccess({
      sub: user.id,
      login: user.login,
      role: user.role,
    });
    const refreshToken = await this.jwt.signRefresh({
      sub: user.id,
      jti: randomUUID(),
    });

    const refresh = this.jwt.decodeUnverified<{ exp?: number }>(refreshToken);
    const access = this.jwt.decodeUnverified<{ iat?: number; exp?: number }>(
      accessToken,
    );
    if (
      !refresh?.exp ||
      !access?.exp ||
      !access.iat ||
      access.exp <= access.iat
    ) {
      throw new DomainError('INTERNAL', 'invalid token lifetime');
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: access.exp - access.iat,
      refreshExpiresAt: new Date(refresh.exp * 1000),
    };
  }

  verifyRefresh(token: string): Promise<{ sub: string }> {
    return this.jwt.verifyRefresh(token);
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
