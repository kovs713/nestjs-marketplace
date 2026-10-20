import { Metadata } from '@grpc/grpc-js';
import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';

import { actor, CurrentActor } from './actor.js';

const USER_ID = '0199eb37-0000-7000-8000-000000000001';

const rpcContext = (metadata?: Metadata) =>
  ({
    switchToRpc: () => ({ getContext: () => metadata }),
  }) as unknown as ExecutionContext;

/** Reaches into the decorator metadata the same way Nest resolves handler params. */
function factoryOf(decorator: () => ParameterDecorator) {
  class Probe {
    handler(@decorator() _value: unknown): void {}
  }

  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');

  return args[Object.keys(args)[0]!].factory as (
    data: unknown,
    ctx: ExecutionContext,
  ) => unknown;
}

describe('actor', () => {
  it('reads the x-user-id metadata', () => {
    // given
    const metadata = new Metadata();
    metadata.set('x-user-id', USER_ID);

    // when & then
    expect(actor(metadata)).toEqual({ id: USER_ID });
  });

  it('rejects missing metadata', () => {
    // when & then
    expect(() => actor(undefined)).toThrow('missing x-user-id metadata');
    expect(() => actor(new Metadata())).toThrow('missing x-user-id metadata');
  });

  it('rejects a malformed user id', () => {
    // given
    const metadata = new Metadata();
    metadata.set('x-user-id', 'not-a-uuid');

    // when & then
    expect(() => actor(metadata)).toThrow('invalid UUID');
  });
});

describe('CurrentActor', () => {
  const factory = factoryOf(CurrentActor);

  it('extracts the actor from the rpc context', () => {
    // given
    const metadata = new Metadata();
    metadata.set('x-user-id', USER_ID);

    // when & then
    expect(factory(undefined, rpcContext(metadata))).toEqual({ id: USER_ID });
  });

  it('fails closed without metadata', () => {
    // when & then
    expect(() => factory(undefined, rpcContext())).toThrow(
      'missing x-user-id metadata',
    );
  });
});
