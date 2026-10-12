import { createMock } from '@golevelup/ts-vitest';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';

import { DomainError } from '../errors/domain-error.js';
import { DomainErrorHttpFilter } from './domain-error.filter.js';

describe('DomainErrorHttpFilter', () => {
  it.each([
    ['INVALID_ARGUMENT', 400],
    ['NOT_FOUND', 404],
    ['ALREADY_EXISTS', 409],
    ['FAILED_PRECONDITION', 409],
    ['PERMISSION_DENIED', 403],
    ['UNAUTHENTICATED', 401],
    ['UNAVAILABLE', 503],
    ['INTERNAL', 500],
  ] as const)('maps %s to HTTP %i', (code, status) => {
    // given
    const response = createMock<Response>();
    response.status.mockReturnValue(response);
    const host = createMock<ArgumentsHost>();
    host.switchToHttp().getResponse.mockReturnValue(response);

    // when
    new DomainErrorHttpFilter().catch(new DomainError(code, 'failure'), host);

    // then
    expect(response.status.mock.calls).toEqual([[status]]);
    expect(response.json.mock.calls).toEqual([[{ message: 'failure' }]]);
  });
});
