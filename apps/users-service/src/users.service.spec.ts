import { createMock, type DeepMocked } from '@golevelup/ts-vitest';

import { UniqueId } from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';
import {
  FIXED_DATE,
  LATER_DATE,
  testUuid,
} from '@app/common/testing/fixtures.js';

import type { User } from './database/users.schema.js';
import { RefreshSession } from './domain/refresh-session.js';
import { TokensService } from './tokens.service.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const userId = testUuid(1);
  const user: User = {
    id: userId,
    login: 'seller',
    email: 'seller@example.com',
    passwordHash: 'password-hash',
    role: 'seller',
    status: 'active',
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
  };
  const refreshExpiresAt = LATER_DATE;

  let repository: DeepMocked<UsersRepository>;
  let tokens: DeepMocked<TokensService>;
  let service: UsersService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
    repository = createMock<UsersRepository>();
    tokens = createMock<TokensService>();
    tokens.hash.mockReturnValue('token-hash');
    tokens.verifyRefresh.mockResolvedValue({ sub: userId });
    tokens.issue.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 900,
      refreshExpiresAt,
    });
    service = new UsersService(repository, tokens);
  });

  afterEach(() => vi.useRealTimers());

  describe('refresh', () => {
    it('should rotate a valid session and issue a new token pair', async () => {
      // given
      const session = RefreshSession.issue(
        {
          userId: UniqueId.from(userId),
          tokenHash: 'token-hash',
          expiresAt: refreshExpiresAt,
        },
        FIXED_DATE,
      );
      repository.refreshSessionByHash.mockResolvedValue(session);
      repository.userById.mockResolvedValue(user);
      repository.rotateRefreshSession.mockResolvedValue(true);

      // when
      const result = await service.refresh('old-refresh');

      // then
      expect(result).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 900,
      });
      expect(tokens.verifyRefresh).toHaveBeenCalledWith('old-refresh');
      expect(repository.refreshSessionByHash).toHaveBeenCalledWith(
        'token-hash',
      );
      expect(repository.rotateRefreshSession).toHaveBeenCalledOnce();
      expect(session.state.revokedAt).toBeInstanceOf(Date);
      expect(
        repository.rotateRefreshSession.mock.calls[0][1].state.tokenHash,
      ).toBe('token-hash');
    });

    it('should reject an invalid refresh token', async () => {
      // given
      const error = new Error('invalid signature');
      tokens.verifyRefresh.mockRejectedValue(error);

      // when & then
      await expect(service.refresh('bad-token')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'invalid refresh token',
      });
      expect(repository.refreshSessionByHash).not.toHaveBeenCalled();
    });

    it('should reject a token without a stored session', async () => {
      // given
      repository.refreshSessionByHash.mockResolvedValue(null);

      // when & then
      await expect(service.refresh('old-refresh')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'refresh token revoked or expired',
      });
    });

    it('should reject when the user is inactive', async () => {
      // given
      const session = RefreshSession.issue(
        {
          userId: UniqueId.from(userId),
          tokenHash: 'token-hash',
          expiresAt: refreshExpiresAt,
        },
        FIXED_DATE,
      );
      repository.refreshSessionByHash.mockResolvedValue(session);
      repository.userById.mockResolvedValue({ ...user, status: 'blocked' });

      // when & then
      await expect(service.refresh('old-refresh')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'user is not active',
      });
      expect(repository.rotateRefreshSession).not.toHaveBeenCalled();
    });

    it('should reject when another refresh request already rotated the session', async () => {
      // given
      const session = RefreshSession.issue(
        {
          userId: UniqueId.from(userId),
          tokenHash: 'token-hash',
          expiresAt: refreshExpiresAt,
        },
        FIXED_DATE,
      );
      repository.refreshSessionByHash.mockResolvedValue(session);
      repository.userById.mockResolvedValue(user);
      repository.rotateRefreshSession.mockResolvedValue(false);

      // when & then
      await expect(service.refresh('old-refresh')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'refresh token revoked or expired',
      });
    });
  });

  describe('logout', () => {
    it('should revoke a stored refresh session', async () => {
      // given
      const session = RefreshSession.issue(
        {
          userId: UniqueId.from(userId),
          tokenHash: 'token-hash',
          expiresAt: refreshExpiresAt,
        },
        FIXED_DATE,
      );
      repository.refreshSessionByHash.mockResolvedValue(session);

      // when
      await service.logout('refresh-token');

      // then
      expect(repository.revokeRefreshSession).toHaveBeenCalledWith(
        'token-hash',
        expect.any(Date),
      );
      expect(session.state.revokedAt).toBeInstanceOf(Date);
    });

    it('should ignore a refresh token without a stored session', async () => {
      // given
      repository.refreshSessionByHash.mockResolvedValue(null);

      // when & then
      await expect(service.logout('unknown-token')).resolves.toBeUndefined();
      expect(repository.revokeRefreshSession).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('should reject an unknown user', async () => {
      // given
      repository.userById.mockResolvedValue(null);

      // when & then
      await expect(service.getMe(userId)).rejects.toThrow(DomainError);
    });

    it('should omit the password hash from the returned user', async () => {
      // given
      repository.userById.mockResolvedValue(user);

      // when
      const result = await service.getMe(userId);

      // then
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.id).toBe(userId);
    });
  });
});
