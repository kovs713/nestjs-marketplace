import type { z } from 'zod';

import { EVENT_SCHEMA_VERSION } from '@app/contracts/events/envelope.js';

type DecodedEvent<S extends Record<string, z.ZodType>> = {
  [K in keyof S]: { eventId: string; eventType: K; payload: z.output<S[K]> };
}[keyof S];

export const decodeEvent = <S extends Record<string, z.ZodType>>(
  payload: unknown,
  headers: Record<string, unknown> | undefined,
  schemas: S,
): DecodedEvent<S> | null => {
  const pick = (name: string): string => {
    const raw = headers?.[name];
    return typeof raw === 'string' ? raw : '';
  };

  const eventId = pick('event_id');
  const eventType = pick('event_type');
  if (eventType && !Object.hasOwn(schemas, eventType)) return null;

  if (!eventType) {
    throw new Error('Missing event_type');
  }
  if (!eventId.trim()) {
    throw new Error('Missing event_id');
  }
  if (pick('schema_version') !== EVENT_SCHEMA_VERSION) {
    throw new Error('Missing or unsupported schema_version');
  }
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new Error('Event payload must be an object');
  }

  return {
    eventId,
    eventType,
    payload: schemas[eventType].parse(payload),
  } as DecodedEvent<S>;
};
