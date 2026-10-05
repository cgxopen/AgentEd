import { mergeAttributes } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

/**
 * #493: GHSA-cp6q-959q-f8rh. Before 2.27.3, `mergeAttributes` assigned an own
 * `__proto__` key with ordinary bracket assignment, which replaced the
 * prototype of the merged object; ProseMirror's DOM serializer enumerates
 * attributes with `for...in`, so the inherited ones reached the DOM. 2.27.3
 * defines the key as a data property instead (backported in upstream
 * commit 0ed4a30), and this pins the version AgentEd ships to that fix.
 *
 * No route in AgentEd hands `mergeAttributes` an object holding such a key,
 * measured on #493; the test pins the primitive, not a route.
 */
describe('mergeAttributes with an own __proto__ key (#493)', () => {
  // The payload of the advisory, parsed from JSON as an imported object would be.
  const payload = '{"__proto__":{"data-canary":"present","onerror":"globalThis.__x = 1"}}';

  it('yields no inherited attribute', () => {
    const merged = mergeAttributes(JSON.parse(payload));
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    const inherited: string[] = [];
    for (const key in merged) if (!Object.hasOwn(merged, key)) inherited.push(key);
    expect(inherited).toEqual([]);
    expect('onerror' in merged).toBe(false);
  });

  it('still merges ordinary attributes as before', () => {
    expect(mergeAttributes({ class: 'a', rel: 'x' }, { class: 'b', href: 'h' })).toEqual({
      class: 'a b',
      rel: 'x',
      href: 'h',
    });
  });
});
