import { describe, expect, it } from 'vitest';
import packageJson from '../package.json?raw';
import packageLock from '../package-lock.json?raw';

/**
 * A version held back on purpose, and why (#518).
 *
 * `prosemirror-view` 1.42 changes behaviour in two places the suite pins:
 * image resize (#252) and pasted empty elements (#311), four tests red on
 * 1.42.6. Until #519 meets that change, `overrides` in package.json keeps
 * every npm resolution below 1.42, Dependabot's included, also when a group
 * moves `@tiptap/pm` to 2.27.3, whose own range asks for 1.42.3 or later.
 * That combination is outside the range `@tiptap/pm` declares; measured on
 * #518, the suite holds on it. JSON takes no comment, so this is where the
 * hold says why: #519 removes the override and this test with it.
 */
describe('prosemirror-view is held below 1.42 (#518, until #519)', () => {
  it('is held in package.json', () => {
    const overrides: Record<string, string> | undefined = JSON.parse(packageJson).overrides;
    expect(overrides?.['prosemirror-view']).toBe('~1.41.7');
  });

  it('is below 1.42 in the lockfile', () => {
    const version: string =
      JSON.parse(packageLock).packages['node_modules/prosemirror-view'].version;
    const [major, minor] = version.split('.').map(Number);
    expect(major === 1 && minor < 42, `prosemirror-view ${version}`).toBe(true);
  });
});
