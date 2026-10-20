import { DomainError } from '../../errors/domain-error.js';
import type { Quantity } from './quantity.vo.js';

export class Money {
  private constructor(readonly minor: number) {
    Object.freeze(this);
  }

  static fromMinor(value: number): Money {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        'money must be nonnegative safe integer minor units',
      );
    }

    return new Money(value);
  }

  static zero(): Money {
    return new Money(0);
  }

  add(other: Money): Money {
    return Money.fromMinor(this.minor + other.minor);
  }

  multiply(quantity: Quantity): Money {
    return Money.fromMinor(this.minor * quantity.value);
  }

  equals(other: Money): boolean {
    return this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0;
  }
}
