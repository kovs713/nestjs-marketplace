import { z } from 'zod';

import { PRODUCT_CREATED, productCreatedSchema } from '@app/contracts';

import { decodeEvent } from './envelope.js';

describe('decodeEvent', () => {
  const schemas = { [PRODUCT_CREATED]: productCreatedSchema };
  const payload = {
    product_id: 'product-1',
    seller_id: 'seller-1',
    initial_stock: 5,
  };
  const headers = {
    event_id: 'event-1',
    event_type: PRODUCT_CREATED,
    schema_version: '1',
  };

  it('validates the payload and string headers parsed by Nest', () => {
    // when & then
    expect(decodeEvent(payload, headers, schemas)).toEqual({
      eventId: 'event-1',
      eventType: PRODUCT_CREATED,
      payload,
    });
  });

  it.each([null, undefined, [], '{invalid JSON', '123', 123])(
    'rejects non-object payload %j',
    (value) => {
      // when & then
      expect(() => decodeEvent(value, headers, schemas)).toThrow();
    },
  );

  it.each([
    undefined,
    {},
    { ...headers, event_id: ' ' },
    { ...headers, event_id: {} },
    { ...headers, event_type: '' },
    { ...headers, schema_version: '2' },
    { ...headers, schema_version: 1 },
  ])('rejects missing or invalid headers %j', (value) => {
    // when & then
    expect(() => decodeEvent(payload, value, schemas)).toThrow();
  });

  it('ignores unrelated types before validating their payload', () => {
    // when & then
    expect(decodeEvent(null, { event_type: 'unrelated' }, schemas)).toBeNull();
  });

  it('ignores inherited property names as unrelated event types', () => {
    expect(decodeEvent(null, { event_type: 'toString' }, schemas)).toBeNull();
  });

  it('rejects payloads that do not match the selected schema', () => {
    expect(() =>
      decodeEvent({ ...payload, initial_stock: -1 }, headers, schemas),
    ).toThrow();
  });

  it('uses caller schemas and infers a discriminated result', () => {
    const schemas = {
      'test.counted': z.object({ count: z.number() }),
      'test.named': z.object({ name: z.string() }),
    };
    const event = decodeEvent(
      { name: 'example' },
      { ...headers, event_type: 'test.named' },
      schemas,
    );

    expect(event).toEqual({
      eventId: headers.event_id,
      eventType: 'test.named',
      payload: { name: 'example' },
    });
    if (event?.eventType === 'test.named') {
      expectTypeOf(event.payload).toEqualTypeOf<{ name: string }>();
    } else if (event?.eventType === 'test.counted') {
      expectTypeOf(event.payload).toEqualTypeOf<{ count: number }>();
    }
    expect(() =>
      decodeEvent(
        { count: 1 },
        { ...headers, event_type: 'test.named' },
        schemas,
      ),
    ).toThrow();
  });
});
