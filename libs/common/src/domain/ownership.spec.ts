import { assertOwnership } from './ownership.js';
import { UniqueId } from './value-objects/unique-id.vo.js';

describe('assertOwnership', () => {
  const owner = UniqueId.from('0199eb37-0000-7000-8000-000000000001');
  const other = UniqueId.from('0199eb37-0000-7000-8000-000000000002');

  it('allows the owner', () => {
    // when & then
    expect(() => assertOwnership(owner, owner, 'thing')).not.toThrow();
  });

  it('rejects a different actor', () => {
    // when & then
    expect(() => assertOwnership(owner, other, 'thing')).toThrow(
      'not your thing',
    );
  });
});
