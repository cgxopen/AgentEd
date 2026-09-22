import { describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import toolbarSource from './toolbar.ts?raw';

/**
 * Issue #418, point i — which element the floating toolbar takes as its floor.
 *
 * **Said first: nothing here sees where the bar lands.** happy-dom performs no
 * layout, so `getBoundingClientRect` answers 0 for every box and a row that
 * built a toolbar and asked where it went would assert nothing. The arithmetic
 * is pinned next door in `toolbar-placement.test.ts`; what was pinned nowhere
 * is **which element `toolbar.ts` measures**, and putting `#menubar` back left
 * the whole suite green - 3999 passed, measured on `7fd1550`.
 *
 * So the two halves that are observable are joined here, and **neither is worth
 * anything alone**: the element is read out of `toolbar.ts` rather than
 * restated, and the shipped markup is read to show that this element is the one
 * that means *the top of the room*. A reordering of `#editor-stack` would leave
 * the first half green and is exactly what the second half is for.
 */

/** The part of `toolbar.ts` that chooses the floor, read rather than restated. */
const floorLine =
  toolbarSource.match(/const room = document\.getElementById\('([^']+)'\)/) ?? undefined;
const floorEdge =
  toolbarSource.match(
    /const roomTop = room === null \? 0 : room\.getBoundingClientRect\(\)\.(\w+)/,
  ) ?? undefined;

describe('the floor is the top of the editor (#418, point i)', () => {
  it('toolbar.ts measures #editor, and its top', () => {
    expect(floorLine, 'toolbar.ts no longer picks its floor by element id').toBeDefined();
    expect(floorLine?.[1]).toBe('editor');
    expect(floorEdge, 'toolbar.ts no longer takes an edge of that element').toBeDefined();
    expect(floorEdge?.[1]).toBe('top');
  });

  it('and passes it to the placement rather than a header bottom', () => {
    // The name is what carries the meaning into `toolbarTop`, whose parameter
    // is `roomTop` since #416. A build that measured the editor and then passed
    // something else would pass the row above and fail this one.
    expect(toolbarSource).toMatch(/toolbarTop\([^)]*roomTop[^)]*\)/);
    expect(toolbarSource).not.toMatch(/const headerBottom/);
  });

  it('the shipped markup puts #editor below both panels, which is what makes it the room', () => {
    // The half that gives the rows above their meaning. `#editor` is only the
    // bottom of whatever is above it while it is the last child of the stack;
    // move it, and measuring it stops answering the question.
    const stack = shippedPage.indexOf('<div id="editor-stack">');
    const close = shippedPage.indexOf('</div>', shippedPage.indexOf('<main id="editor">'));
    expect(stack, 'index.html no longer has an #editor-stack').toBeGreaterThan(-1);
    const inside = shippedPage.slice(stack, close);
    const at = (id: string) => inside.indexOf(`id="${id}"`);
    expect(at('search-panel')).toBeGreaterThan(-1);
    expect(at('frontmatter-panel')).toBeGreaterThan(-1);
    expect(at('editor')).toBeGreaterThan(-1);
    expect(at('editor')).toBeGreaterThan(at('search-panel'));
    expect(at('editor')).toBeGreaterThan(at('frontmatter-panel'));
  });
});
