import type { UniqueId } from '@app/common/domain/value-objects/unique-id.vo.js';
import { DomainError } from '@app/common/errors/domain-error.js';

export interface RefreshSessionProps {
  readonly userId: UniqueId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  revokedAt: Date | null;
}

export class RefreshSession {
  private constructor(private readonly data: RefreshSessionProps) {}

  static issue(
    input: Omit<RefreshSessionProps, 'revokedAt'>,
    now = new Date(),
  ): RefreshSession {
    if (
      !input.userId ||
      !input.tokenHash ||
      !Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt <= now
    ) {
      throw new DomainError('INTERNAL', 'invalid refresh session lifetime');
    }

    return new RefreshSession({ ...input, revokedAt: null });
  }

  static reconstitute(data: RefreshSessionProps): RefreshSession {
    return new RefreshSession(data);
  }

  get state(): RefreshSessionProps {
    return {
      ...this.data,
      expiresAt: new Date(this.data.expiresAt),
      revokedAt: this.data.revokedAt ? new Date(this.data.revokedAt) : null,
    };
  }

  assertUsable(userId: UniqueId, now = new Date()): void {
    if (
      !this.data.userId.equals(userId) ||
      this.data.revokedAt ||
      !Number.isFinite(this.data.expiresAt.getTime()) ||
      this.data.expiresAt <= now
    ) {
      throw new DomainError(
        'UNAUTHENTICATED',
        'refresh token revoked or expired',
      );
    }
  }

  consume(userId: UniqueId, now = new Date()): void {
    this.assertUsable(userId, now);
    this.revoke(now);
  }

  revoke(now = new Date()): void {
    this.data.revokedAt ??= new Date(now);
  }
}
