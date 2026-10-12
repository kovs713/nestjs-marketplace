import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';

import { TOKEN_CONFIG_KEY, type JwtConfig } from './jwt.config.js';
import { AccessClaims, RefreshClaims } from './jwt.type.js';
import { z } from 'zod';

const accessClaims = z.object({
  purpose: z.literal('access'),
  sub: z.string().min(1),
  login: z.string().min(1),
  role: z.enum(['buyer', 'seller', 'admin']),
  exp: z.number().int().positive(),
});
const refreshClaims = z.object({
  purpose: z.literal('refresh'),
  sub: z.string().min(1),
  jti: z.string().min(1),
  exp: z.number().int().positive(),
});

@Injectable()
export class AppJwtService {
  private readonly cfg: JwtConfig;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<JwtConfig>(TOKEN_CONFIG_KEY);
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(
      { ...claims, purpose: 'access' },
      {
        expiresIn: this.cfg.accessTtl as JwtSignOptions['expiresIn'],
      },
    );
  }

  signRefresh(claims: RefreshClaims): Promise<string> {
    return this.jwt.signAsync(
      { ...claims, purpose: 'refresh' },
      {
        expiresIn: this.cfg.refreshTtl as JwtSignOptions['expiresIn'],
      },
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    return accessClaims.parse(await this.jwt.verifyAsync(token));
  }

  async verifyRefresh(token: string): Promise<RefreshClaims> {
    return refreshClaims.parse(await this.jwt.verifyAsync(token));
  }

  decodeUnverified<T extends object = Record<string, unknown>>(
    token: string,
  ): T | null {
    return this.jwt.decode<T>(token);
  }
}
