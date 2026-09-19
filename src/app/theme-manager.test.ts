/**
 * Issue #379 — Claude Warm became Paper Warm, its stored name and its
 * `data-theme` value included.
 *
 * Two things a rename can break that no per-palette row sees. A person who
 * chose the palette has the old name stored, and a name the preferences do not
 * know reads as Default, in silence. And the value `ThemeManager` sets on the
 * page is tied to a block of the sheet by nothing but spelling: the per-palette
 * rows take their names from the sheet, so a selector left behind is read under
 * its old name and every one of them stays green, while the page draws the
 * palette with the Light tokens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaletteName, ThemePreference } from '../preferences';
import stylesCss from '../styles.css?raw';
import { stylesheetRules } from '../test-support/stylesheet-rules';
import { paletteTokens } from '../test-support/theme-colours';
import { setupAppearanceMenu } from '../ui/appearance-menu';
import { ThemeManager } from './theme-manager';

const sheetPalettes = paletteTokens(stylesheetRules(stylesCss));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a palette chosen before the rename opens as Paper Warm (#379)', () => {
  it('sets the new palette on the page the moment the manager is built', () => {
    localStorage.setItem('agented:palette', 'claude');
    const manager = new ThemeManager();

    expect(manager.getPalette()).toBe('paper');
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
  });

  it('writes the new name back, so the old one is read once', () => {
    localStorage.setItem('agented:palette', 'claude');
    new ThemeManager();

    expect(localStorage.getItem('agented:palette')).toBe('paper');
  });
});

/** Every palette the Appearance menu offers, read from the menu it builds. */
function offeredPalettes(): PaletteName[] {
  document.body.innerHTML = `
    <button id="appearance-menu-trigger" type="button"></button>
    <aside id="appearance-popover" class="appearance-popover hidden"></aside>`;
  setupAppearanceMenu(new ThemeManager());
  const options = document.querySelectorAll<HTMLElement>('.appearance-palette');
  const names = [...options].map((option) => option.dataset.palette as PaletteName);
  document.body.innerHTML = '';
  return names;
}

describe('every palette the menu offers is drawn by a block of the sheet (#379)', () => {
  const palettes = offeredPalettes();

  it('offers four', () => {
    expect(palettes).toHaveLength(4);
  });

  it.each(palettes)('%s: in Light and in Dark, the value set on the page has a block', (name) => {
    const set: Array<string | null> = [];
    for (const mode of ['light', 'dark'] as ThemePreference[]) {
      localStorage.setItem('agented:theme', mode);
      localStorage.setItem('agented:palette', name);
      new ThemeManager();
      set.push(document.documentElement.getAttribute('data-theme'));
    }
    // No attribute is the bare `:root` block, which the sheet reads as light.
    const drawnBy = set.map((value) => (value === null ? 'light' : value));

    for (const value of drawnBy) expect([...sheetPalettes.keys()], name).toContain(value);
  });
});
