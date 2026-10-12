import type { Metadata } from '@grpc/grpc-js';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { DomainError } from '../errors/domain-error.js';
import { validateUuid } from '../utils/validation.util.js';

export interface Actor {
  id: string;
}

export function actor(metadata?: Metadata): Actor {
  const id = metadata?.get('x-user-id')[0]?.toString();

  if (!id) {
    throw new DomainError('UNAUTHENTICATED', 'missing x-user-id metadata');
  }

  validateUuid(id);

  return { id };
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor => {
    return actor(ctx.switchToRpc().getContext<Metadata>());
  },
);
