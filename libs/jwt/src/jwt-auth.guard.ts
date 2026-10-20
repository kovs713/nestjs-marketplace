import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AppJwtService } from './jwt.service.js';
import type { Request } from './jwt.type.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: AppJwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('missing bearer token');
    }
    try {
      req.user = await this.tokens.verifyAccess(token);
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }
}
