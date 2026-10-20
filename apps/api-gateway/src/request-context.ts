import { AsyncLocalStorage } from 'node:async_hooks';

import type { Request } from '@app/jwt';

export interface RequestContext {
  request: Request;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
