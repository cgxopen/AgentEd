/**
 * #391 — under Paper Warm the Mode section shows Light, the mode the page is
 * in, greys Dark and Auto with a line saying why, and keeps the mode the person
 * chose for the palette they go to next.
 *
 * **Said first: colour and greying are not observable in this harness.** What
 * is held here is which option is marked, that Dark and Auto are disabled
 * buttons, the stored preference, and the colour the stylesheet gives the line
 * and a greyed label, computed from the Paper Warm tokens rather than seen.
 * How the section looks is verified in the owner pass on the artifact.
 *
 * Each describe block below holds one property, so that the three reversals
 * named on the issue redden separate rows: the stored mode marked instead of
 * the effective one, Dark or Auto left choosable, and the stored mode
 * overwritten when Paper Warm is chosen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasDarkVersion, ThemeManager } from '../app/theme-manager';
import type { PaletteName, ThemePreference } from '../preferences';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, over, paletteTokens, resolveColour } from '../test-support/theme-colours';
import { MODE_NOTE_ID, setupAppearanceMenu } from './appearance-menu';

const rules = stylesheetRules(stylesCss);
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const PAPER = paletteTokens(rules).get('paper') as ReadonlyMap<string, string>;

/** The modes Paper Warm has to set aside; Light needs nothing set aside. */
const SET_ASIDE: readonly ThemePreference[] = ['dark', 'auto'];

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

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});

describe('the theme manager answers which palettes have a dark version (#391)', () => {
  it.each([
    'default',
    'paper',
    'solarized',
    'github',
  ] as const)('%s: has one exactly when Dark draws it differently from Light', (palette) => {
    const drawn = (['light', 'dark'] as const).map((mode) => {
      start(mode, palette);
      return document.documentElement.getAttribute('data-theme');
    });
    expect(hasDarkVersion(palette)).toBe(drawn[0] !== drawn[1]);
  });

  it('says Paper Warm has none', () => {
    expect(hasDarkVersion('paper')).toBe(false);
  });
});

describe('under Paper Warm the Mode section marks Light, the mode the page is in (#391)', () => {
  it.each(SET_ASIDE)('with %s stored, choosing Paper Warm marks Light', (mode) => {
    start(mode, 'default');
    choosePalette('paper');
    expect(marked()).toBe('light');
  });

  it.each(SET_ASIDE)('with %s stored and Paper Warm, a new window marks Light', (mode) => {
    start(mode, 'paper');
    expect(marked()).toBe('light');
  });
});

describe('under Paper Warm Dark and Auto cannot be chosen (#391)', () => {
  it.each(SET_ASIDE)('%s is a disabled button, and pressing it changes nothing', (mode) => {
    start('light', 'paper');
    const option = modeOption(mode);
    expect(option.disabled).toBe(true);
    option.click();
    expect(manager.getMode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
  });
});

describe('the line says why, and only while it is true (#391)', () => {
  it('reads No dark version, and is read out on Light', () => {
    start('dark', 'paper');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe('No dark version.');
    expect(modeOption('light').getAttribute('aria-describedby')).toBe(MODE_NOTE_ID);
  });

  it('is gone under a palette with a dark version, and every mode is choosable again', () => {
    start('dark', 'paper');
    choosePalette('github');
    expect(note().hidden).toBe(true);
    expect(modeOption('light').hasAttribute('aria-describedby')).toBe(false);
    for (const mode of ['light', 'dark', 'auto'] as const) {
      expect(modeOption(mode).disabled, mode).toBe(false);
    }
  });
});

describe('the mode the person chose is kept for the palette they go to next (#391)', () => {
  it.each(SET_ASIDE)('%s, then Paper Warm, then Default: the stored mode comes back', (mode) => {
    start(mode, 'default');
    choosePalette('paper');
    choosePalette('default');
    expect(localStorage.getItem('agented:theme')).toBe(mode);
    expect(marked()).toBe(mode);
  });
});

describe('the line can be read and the greyed labels are exempt, in Paper Warm (#391)', () => {
  const ground = () => {
    const popover = document.getElementById('appearance-popover') as HTMLElement;
    const value = valuesReaching(atEveryWidth, popover, 'background').at(-1) as string;
    return resolveColour(value, PAPER);
  };

  it('draws the line at 4.71 against the popover, above the 4.5 text needs', () => {
    start('dark', 'paper');
    const colour = valuesReaching(atEveryWidth, note(), 'color').at(-1) as string;
    const ratio = contrast(resolveColour(colour, PAPER), ground());
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(4.71, 2);
  });

  it('draws a greyed label at 3.12, exempt as a disabled control', () => {
    start('dark', 'paper');
    const option = modeOption('dark');
    const colour = valuesReaching(atEveryWidth, option, 'color').at(-1) as string;
    const opacity = Number(valuesReaching(atEveryWidth, option, 'opacity').at(-1));
    const text = resolveColour(colour, PAPER);
    const ratio = contrast(over({ ...text, a: text.a * opacity }, ground()), ground());
    expect(ratio).toBeCloseTo(3.12, 2);
  });
});
