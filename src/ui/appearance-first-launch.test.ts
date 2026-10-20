/**
 * #635 - a first launch, with no palette stored, draws Paper Warm while the
 * mode resolves light and Default while it resolves dark, and the Appearance
 * menu marks the palette drawn (owner decisions of 2026-10-20). A palette the
 * person chooses is stored and behaves as before, so a chosen Paper Warm greys
 * Dark and Auto (#391). And links in Paper Warm have a colour of their own, at
 * 4.5 or more on every ground a link of a document stands on.
 *
 * **Said first: what a window shows is not observable here.** The system mode
 * is a stub of `matchMedia`, colour is computed from the tokens of the sheet,
 * and nothing is painted. What WebView2 draws on a first launch, and the white
 * frame before the theme (#639), are the owner pass on the artifact. These
 * rows hold the attribute the page is given, the options marked and greyed,
 * what is stored, and the link figures computed from `styles.css`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager } from '../app/theme-manager';
import type { PaletteName, ThemePreference } from '../preferences';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, over, paletteTokens, resolveColour } from '../test-support/theme-colours';
import { setupAppearanceMenu } from './appearance-menu';

/** The system mode, and the listeners a change of it reaches. */
const system = { dark: false, listeners: [] as Array<() => void> };

function stubSystem(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return system.dark;
    },
    addEventListener: (_type: string, listener: () => void) => system.listeners.push(listener),
    removeEventListener: (_type: string, listener: () => void) => {
      system.listeners = system.listeners.filter((l) => l !== listener);
    },
  }));
}

function switchSystem(dark: boolean): void {
  system.dark = dark;
  for (const listener of [...system.listeners]) listener();
}

let manager: ThemeManager;

/** A launch, with whatever the test stored before it. */
function launch(): void {
  document.body.innerHTML = `
    <button id="appearance-menu-trigger" type="button"></button>
    <aside id="appearance-popover" class="appearance-popover hidden"></aside>`;
  manager = new ThemeManager();
  setupAppearanceMenu(manager);
  (document.getElementById('appearance-menu-trigger') as HTMLElement).click();
}

const theme = () => document.documentElement.getAttribute('data-theme');
const markedPalette = () =>
  (document.querySelector('.appearance-palette.active') as HTMLElement | null)?.dataset.palette;
const markedMode = () =>
  (document.querySelector('.appearance-mode.active') as HTMLElement | null)?.dataset.mode;
const greyed = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.appearance-mode')]
    .filter((b) => b.disabled)
    .map((b) => b.dataset.mode);
const choose = (palette: PaletteName) =>
  (document.querySelector(`.appearance-palette[data-palette="${palette}"]`) as HTMLElement).click();
const chooseMode = (mode: ThemePreference) =>
  (document.querySelector(`.appearance-mode[data-mode="${mode}"]`) as HTMLElement).click();
const stored = () => [
  localStorage.getItem('agented:palette'),
  localStorage.getItem('agented:theme'),
];

beforeEach(() => {
  localStorage.clear();
  system.dark = false;
  system.listeners = [];
  stubSystem();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});

describe('a first launch, nothing stored (#635)', () => {
  it('on a light system: Paper Warm, marked, Auto marked, nothing greyed', () => {
    launch();
    expect(theme()).toBe('paper');
    expect(markedPalette()).toBe('paper');
    expect(markedMode()).toBe('auto');
    expect(greyed()).toEqual([]);
  });

  it('on a dark system: Default dark, Default marked, Auto marked, nothing greyed', () => {
    system.dark = true;
    launch();
    expect(theme()).toBe('dark');
    expect(markedPalette()).toBe('default');
    expect(markedMode()).toBe('auto');
    expect(greyed()).toEqual([]);
  });

  it('stores nothing, on either system and after the system changes', () => {
    launch();
    switchSystem(true);
    expect(stored()).toEqual([null, null]);
  });
});

describe('the system mode changing while no palette is chosen (#635)', () => {
  it('light to dark: the page and the menu follow to Default', () => {
    launch();
    switchSystem(true);
    expect(theme()).toBe('dark');
    expect(markedPalette()).toBe('default');
  });

  it('dark to light: the page and the menu follow to Paper Warm', () => {
    system.dark = true;
    launch();
    switchSystem(false);
    expect(theme()).toBe('paper');
    expect(markedPalette()).toBe('paper');
  });
});

describe('a choice made while no palette is chosen (#635)', () => {
  it('Paper Warm chosen on a dark system: stored, light, Dark and Auto greyed (#391)', () => {
    system.dark = true;
    launch();
    choose('paper');
    expect(stored()[0]).toBe('paper');
    expect(theme()).toBe('paper');
    expect(markedMode()).toBe('light');
    expect(greyed()).toEqual(['dark', 'auto']);
  });

  it('Default chosen on a light system: stored, and Auto then follows the system', () => {
    launch();
    choose('default');
    expect(stored()[0]).toBe('default');
    expect(theme()).toBeNull();
    switchSystem(true);
    expect(theme()).toBe('dark');
    expect(markedPalette()).toBe('default');
  });

  it('Dark chosen as a mode: Default drawn and marked, the mode stored and no palette', () => {
    launch();
    chooseMode('dark');
    expect(theme()).toBe('dark');
    expect(markedPalette()).toBe('default');
    expect(stored()).toEqual([null, 'dark']);
  });
});

describe('a stored palette is drawn as before (#635)', () => {
  it.each([
    { palette: 'paper', dark: true, drawn: 'paper', marked: 'light', grey: ['dark', 'auto'] },
    { palette: 'default', dark: false, drawn: null, marked: 'auto', grey: [] },
    { palette: 'default', dark: true, drawn: 'dark', marked: 'auto', grey: [] },
    { palette: 'solarized', dark: true, drawn: 'solarized-dark', marked: 'auto', grey: [] },
    { palette: 'oled', dark: false, drawn: 'oled', marked: 'dark', grey: ['light', 'auto'] },
  ] as const)('$palette on a dark system $dark', ({ palette, dark, drawn, marked, grey }) => {
    localStorage.setItem('agented:palette', palette);
    system.dark = dark;
    launch();
    expect(theme()).toBe(drawn);
    expect(markedPalette()).toBe(palette);
    expect(markedMode()).toBe(marked);
    expect(greyed()).toEqual(grey);
    switchSystem(!dark);
    expect(markedPalette()).toBe(palette);
    expect(stored()).toEqual([palette, null]);
  });

  it('a value it does not know is Default, as before', () => {
    localStorage.setItem('agented:palette', 'github');
    launch();
    expect(theme()).toBeNull();
    expect(markedPalette()).toBe('default');
  });
});

describe('links in Paper Warm reach 4.5 on every ground of a document (#635)', () => {
  const rules = stylesheetRules(stylesCss);
  const palettes = paletteTokens(rules);
  const PAPER = palettes.get('paper') as ReadonlyMap<string, string>;
  const colour = (value: string, tokens: ReadonlyMap<string, string>) =>
    resolveColour(value, tokens);

  it('a link of a document is drawn in the link colour', () => {
    const page = document.createElement('div');
    page.className = 'tiptap';
    page.innerHTML = '<p><a href="https://example.com">a link</a></p>';
    document.body.appendChild(page);
    const link = page.querySelector('a') as HTMLElement;
    const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
    expect(valuesReaching(atEveryWidth, link, 'color')).toEqual(['var(--link)']);
  });

  it('every ground a link stands on: the page, a header cell or inline code, a selected cell, a search hit', () => {
    const link = colour('var(--link)', PAPER);
    const bg = colour('var(--bg)', PAPER);
    const surface = colour('var(--surface)', PAPER);
    const selection = colour('var(--selection-accent)', PAPER);
    const hit = colour('rgba(250, 204, 21, 0.35)', PAPER);
    const current = colour('rgba(250, 204, 21, 0.7)', PAPER);
    const grounds = [bg, surface];
    for (const ground of [bg, surface]) {
      grounds.push(over(selection, ground), over(hit, ground), over(current, ground));
    }
    const lowest = Math.min(...grounds.map((ground) => contrast(link, ground)));
    expect(lowest).toBeGreaterThanOrEqual(4.5);
    // Today: the accent, 3.82 on the page.
    expect(contrast(colour('var(--accent)', PAPER), bg)).toBeLessThan(4.5);
  });

  it('every other palette keeps its accent as its link colour', () => {
    for (const [name, tokens] of palettes) {
      if (name === 'paper') continue;
      expect(colour('var(--link)', tokens), name).toEqual(colour('var(--accent)', tokens));
    }
  });
});
