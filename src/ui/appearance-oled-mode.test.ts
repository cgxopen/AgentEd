/**
 * #398 — OLED Black, a pure black palette with no light version, in place of
 * the GitHub pair.
 *
 * **Said first: colour is not observable in this harness.** happy-dom paints
 * nothing. What is held here is which option is marked, that Light and Auto
 * are disabled buttons, the stored preference, and the contrast each token
 * computes to, read out of the shipped stylesheet. Whether pure black reads
 * well, and whether a code block is legible on it, is the owner pass on the
 * artifact.
 *
 * It is the mirror of `appearance-paper-mode.test.ts`, and each block holds
 * one property so that the reversals named on the issue redden separate rows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missingMode, paletteHasMode, ThemeManager } from '../app/theme-manager';
import type { PaletteName, ThemePreference } from '../preferences';
import stylesCss from '../styles.css?raw';
import { stylesheetRules } from '../test-support/stylesheet-rules';
import { contrast, paletteTokens, resolveColour } from '../test-support/theme-colours';
import { MODE_NOTE_ID, setupAppearanceMenu } from './appearance-menu';

const rules = stylesheetRules(stylesCss);
const palettes = paletteTokens(rules);
const OLED = palettes.get('oled') as ReadonlyMap<string, string>;

/** WCAG 1.4.3 for text, and 1.4.11 for a line or a mark. */
const TEXT = 4.5;
const NON_TEXT = 3;

/** The modes OLED Black has to set aside; Dark is the one it has. */
const SET_ASIDE: readonly ThemePreference[] = ['light', 'auto'];

let manager: ThemeManager;

function start(mode: ThemePreference, palette: PaletteName): void {
  localStorage.setItem('agented:theme', mode);
  localStorage.setItem('agented:palette', palette);
  document.body.innerHTML = `
    <button id="appearance-menu-trigger" type="button"></button>
    <aside id="appearance-popover" class="appearance-popover hidden"></aside>`;
  manager = new ThemeManager();
  setupAppearanceMenu(manager);
  (document.getElementById('appearance-menu-trigger') as HTMLElement).click();
}

const modeOption = (mode: ThemePreference) =>
  document.querySelector(`.appearance-mode[data-mode="${mode}"]`) as HTMLButtonElement;
const choosePalette = (palette: PaletteName) =>
  (document.querySelector(`.appearance-palette[data-palette="${palette}"]`) as HTMLElement).click();
const marked = () =>
  (document.querySelector('.appearance-mode.active') as HTMLElement).dataset.mode;
const note = () => document.getElementById(MODE_NOTE_ID) as HTMLElement;

/** The colour a token resolves to in OLED Black. */
const token = (name: string) => resolveColour(`var(${name})`, OLED);
const ratio = (a: string, b: string) => contrast(token(a), token(b));

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});

describe('OLED Black is dark only, and the manager says so (#398)', () => {
  it('has a dark version and no light one', () => {
    expect(paletteHasMode('oled', 'dark')).toBe(true);
    expect(paletteHasMode('oled', 'light')).toBe(false);
    expect(missingMode('oled')).toBe('light');
  });

  it('draws the page black in every mode, from the one block the sheet has', () => {
    for (const mode of ['light', 'dark', 'auto'] as const) {
      start(mode, 'oled');
      expect(document.documentElement.getAttribute('data-theme'), mode).toBe('oled');
    }
    expect(OLED.get('--bg')).toBe('#000000');
  });
});

describe('under OLED Black the Mode section marks Dark, the mode the page is in (#398)', () => {
  it.each(SET_ASIDE)('with %s stored, choosing OLED Black marks Dark', (mode) => {
    start(mode, 'default');
    choosePalette('oled');
    expect(marked()).toBe('dark');
  });

  it.each(SET_ASIDE)('with %s stored and OLED Black, a new window marks Dark', (mode) => {
    start(mode, 'oled');
    expect(marked()).toBe('dark');
  });
});

describe('under OLED Black Light and Auto cannot be chosen (#398)', () => {
  it.each(SET_ASIDE)('%s is a disabled button, and pressing it changes nothing', (mode) => {
    start('dark', 'oled');
    const option = modeOption(mode);
    expect(option.disabled).toBe(true);
    option.click();
    expect(manager.getMode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oled');
  });
});

describe('the line says which version is missing (#398)', () => {
  it('reads No light version, and is read out on Dark', () => {
    start('light', 'oled');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe('No light version.');
    expect(modeOption('dark').getAttribute('aria-describedby')).toBe(MODE_NOTE_ID);
  });

  it('reads No dark version under Paper Warm, from the same one line', () => {
    start('dark', 'paper');
    expect(note().textContent).toBe('No dark version.');
    expect(modeOption('light').getAttribute('aria-describedby')).toBe(MODE_NOTE_ID);
  });
});

describe('the mode the person chose is kept for the palette they go to next (#398)', () => {
  it.each(SET_ASIDE)('%s, then OLED Black, then Default: the stored mode comes back', (mode) => {
    start(mode, 'default');
    choosePalette('oled');
    choosePalette('default');
    expect(localStorage.getItem('agented:theme')).toBe(mode);
    expect(marked()).toBe(mode);
  });
});

describe('the palette named github is nowhere (#398)', () => {
  it('is offered by no entry of the popover, and drawn by no block of the sheet', () => {
    start('dark', 'default');
    const offered = [...document.querySelectorAll<HTMLElement>('.appearance-palette')].map(
      (option) => option.dataset.palette,
    );
    expect(offered).toEqual(['default', 'paper', 'solarized', 'oled']);
    expect([...palettes.keys()]).not.toContain('github-dark');
    expect([...palettes.keys()]).not.toContain('github-light');
  });

  it('shows OLED Black with its page and its accent, and says what it is for', () => {
    start('dark', 'default');
    const entry = document.querySelector<HTMLElement>('.appearance-palette[data-palette="oled"]');
    const circle = entry?.querySelector<HTMLElement>('.swatch');
    expect(entry?.textContent).toContain('OLED Black');
    expect(entry?.title).toBe('Pure black. Saves battery on OLED screens.');
    expect(circle?.style.background).toBe(
      `linear-gradient(135deg, ${OLED.get('--bg')} 50%, ${OLED.get('--accent')} 50%)`,
    );
  });
});

describe('every token of OLED Black clears its floor on pure black (#398)', () => {
  it.each([
    ['--text', '--bg', TEXT, 14.17],
    ['--text', '--surface', TEXT, 12.74],
    ['--muted', '--bg', TEXT, 6.49],
    ['--muted', '--surface', TEXT, 5.84],
    ['--muted', '--code-inline-bg', TEXT, 5.27],
    ['--border', '--bg', NON_TEXT, 3.94],
    ['--border', '--surface', NON_TEXT, 3.54],
    ['--accent', '--bg', NON_TEXT, 9.77],
    ['--code-text', '--code-bg', TEXT, 12.74],
  ] as const)('%s on %s clears %f, at %f', (front, ground, floor, figure) => {
    const measured = ratio(front, ground);
    expect(measured).toBeGreaterThanOrEqual(floor);
    expect(measured).toBeCloseTo(figure, 2);
  });

  it('draws its surfaces lighter than the page, since nothing can be darker', () => {
    // The page emits nothing; every step above it is light the screen then
    // emits, so these are the smallest steps that still read as a block.
    expect(ratio('--surface', '--bg')).toBeCloseTo(1.11, 2);
    expect(ratio('--code-bg', '--bg')).toBeCloseTo(1.11, 2);
    expect(ratio('--code-inline-bg', '--bg')).toBeCloseTo(1.23, 2);
  });

  it('has no shadow to stand on, so a card is its border alone', () => {
    const shadow = resolveColour(OLED.get('--shadow-sm') as string, OLED);
    const page = token('--bg');
    const painted = {
      r: shadow.r * shadow.a + page.r * (1 - shadow.a),
      g: shadow.g * shadow.a + page.g * (1 - shadow.a),
      b: shadow.b * shadow.a + page.b * (1 - shadow.a),
      a: 1,
    };
    expect(contrast(painted, page)).toBeCloseTo(1, 3);
  });
});
