import { DomainError } from '../../errors/domain-error.js';

export class Quantity {
  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  static from(value: number): Quantity {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        'quantity must be a positive int32',
      );
    }

    return new Quantity(value);
  }

  add(other: Quantity): Quantity {
    return Quantity.from(this.value + other.value);
  }

  equals(other: Quantity): boolean {
    return this.value === other.value;
  }
}
