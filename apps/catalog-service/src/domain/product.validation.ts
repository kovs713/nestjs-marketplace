import { DomainError } from '@app/common/errors/domain-error.js';

import type { ProductPatch } from './product.js';

export function validateTitle(title: string): void {
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    Array.from(title).length > 200
  ) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'title must contain 1–200 characters',
    );
  }
}

export function validateProductPatch(patch: ProductPatch): void {
  if (patch.title !== undefined) {
    validateTitle(patch.title);
  }

  if (
    patch.categoryIds &&
    new Set(patch.categoryIds.map((id) => id.value)).size !==
      patch.categoryIds.length
  ) {
    throw new DomainError('INVALID_ARGUMENT', 'duplicate category ids');
  }
}
