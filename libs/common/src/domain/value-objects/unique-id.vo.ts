import { randomUUID } from 'node:crypto';

import { validateUuid } from '../../utils/validation.util.js';

export class UniqueId {
  private constructor(readonly value: string) {}

  static create(): UniqueId {
    return new UniqueId(randomUUID());
  }

  static from(value: string): UniqueId {
    validateUuid(value);
    return new UniqueId(value.toLowerCase());
  }

  equals(other: UniqueId): boolean {
    return this.value === other.value;
  }
}
