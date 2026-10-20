import { DomainError } from '../../errors/domain-error.js';

export class StockQuantity {
  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  static from(value: number): StockQuantity {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        'stock must be a nonnegative int32',
      );
    }

    return new StockQuantity(value);
  }

  add(other: StockQuantity): StockQuantity {
    return StockQuantity.from(this.value + other.value);
  }

  subtract(other: StockQuantity): StockQuantity {
    return StockQuantity.from(this.value - other.value);
  }

  equals(other: StockQuantity): boolean {
    return this.value === other.value;
  }
}
