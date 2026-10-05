import { describe, expect, it } from 'vitest';

/**
 * The two repairs `vitest.setup.ts` makes to the test environment (#482),
 * pinned so that a change of Node or happy-dom that undoes one shows here
 * rather than as a few hundred unrelated failures.
 */
describe('the test environment (#482)', () => {
  it.each(['localStorage', 'sessionStorage'] as const)('has a working %s', (name) => {
    const storage = globalThis[name];
    storage.setItem('agented-probe', 'x');
    expect(storage.getItem('agented-probe')).toBe('x');
    storage.removeItem('agented-probe');
  });

  it('answers the name of an element through the getter on Node.prototype, as a browser does', () => {
    const getter = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeName')?.get;
    expect(getter?.call(document.createElement('style'))).toBe('STYLE');
    expect(getter?.call(document.createTextNode('a'))).toBe('#text');
    // A DocumentFragment is still answered with an empty string: happy-dom
    // has no name for it on any class (happy-dom #2451). Nothing here reads
    // it, so the shim leaves it as it is.
  });
});
