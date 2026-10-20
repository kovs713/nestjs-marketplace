import { UniqueId } from '@app/common';
import { DomainError } from '@app/common/errors/domain-error.js';
import {
  FIXED_DATE,
  LATER_DATE,
  testUuid,
} from '@app/common/testing/fixtures.js';

import { RefreshSession } from './refresh-session.js';

describe('RefreshSession', () => {
  const userId = UniqueId.from(testUuid(1));
  const otherUserId = UniqueId.from(testUuid(2));
  const expiresAt = LATER_DATE;
  const revokedAt = FIXED_DATE;

  const issueSession = (
    overrides: { expiresAt?: Date; tokenHash?: string } = {},
  ) =>
    RefreshSession.issue(
      {
        userId,
        tokenHash: 'token-hash',
        expiresAt,
        ...overrides,
      },
      FIXED_DATE,
    );

  describe('issue', () => {
    it('should issue a session with no revocation date', () => {
      // when
      const session = issueSession();

      // then
      expect(session.state).toMatchObject({
        userId,
        tokenHash: 'token-hash',
        expiresAt,
        revokedAt: null,
      });
    });

    it.each([
      { why: 'token hash is empty', tokenHash: '' },
      { why: 'expiry is invalid', expiresAt: new Date(Number.NaN) },
      { why: 'expiry is not in the future', expiresAt: FIXED_DATE },
    ])('should reject when $why', (overrides) => {
      // when & then
      expect(() => issueSession(overrides)).toThrow(DomainError);
    });
  });

  describe('assertUsable', () => {
    it('should allow an active session for its owner', () => {
      // given
      const session = issueSession();

      // when & then
      expect(() => session.assertUsable(userId, FIXED_DATE)).not.toThrow();
    });

    it.each([
      {
        why: 'user does not own the session',
        session: issueSession(),
        userId: otherUserId,
      },
      {
        why: 'session has been revoked',
        session: RefreshSession.reconstitute({
          userId,
          tokenHash: 'token-hash',
          expiresAt,
          revokedAt,
        }),
        userId,
      },
      {
        why: 'session has expired',
        session: RefreshSession.reconstitute({
          userId,
          tokenHash: 'token-hash',
          expiresAt: FIXED_DATE,
          revokedAt: null,
        }),
        userId,
      },
      {
        why: 'expiry is invalid',
        session: RefreshSession.reconstitute({
          userId,
          tokenHash: 'token-hash',
          expiresAt: new Date(Number.NaN),
          revokedAt: null,
        }),
        userId,
      },
    ])('should reject when $why', ({ session, userId: actorId }) => {
      // when & then
      expect(() => session.assertUsable(actorId, FIXED_DATE)).toThrow(
        DomainError,
      );
    });
  });

  describe('consume', () => {
    it('should revoke a usable session at the supplied time', () => {
      // given
      const session = issueSession();

      // when
      session.consume(userId, revokedAt);

      // then
      expect(session.state.revokedAt).toEqual(revokedAt);
      expect(() => session.assertUsable(userId, FIXED_DATE)).toThrow(
        DomainError,
      );
    });
  });

  describe('revoke', () => {
    it('should keep the first revocation time', () => {
      // given
      const session = issueSession();
      session.revoke(revokedAt);

      // when
      session.revoke(expiresAt);

      // then
      expect(session.state.revokedAt).toEqual(revokedAt);
    });
  });

  describe('state', () => {
    it('should return copies of its dates', () => {
      // given
      const session = issueSession();

      // when
      session.state.expiresAt.setTime(0);

      // then
      expect(session.state.expiresAt).toEqual(expiresAt);
    });
  });
});
