import { DomainError } from '../errors/domain-error.js';
import type { UniqueId } from './value-objects/unique-id.vo.js';

/** PERMISSION_DENIED unless `actorId` is the owner of the resource. */
export function assertOwnership(
  ownerId: UniqueId,
  actorId: UniqueId,
  resource: string,
): void {
  if (!ownerId.equals(actorId)) {
    throw new DomainError('PERMISSION_DENIED', `not your ${resource}`);
  }
}
