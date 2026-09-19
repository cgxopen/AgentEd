/**
 * Issue #375 — the surfaces that float over the document draw no line inside
 * them, shade what is under the pointer with one overlay, share one corner
 * radius, and say which emoji has keyboard focus with an accent ring.
 *
 * **Said first: line, shade, radius and focus are not observable in this
 * harness.** happy-dom paints nothing, lays nothing out and has no pointer.
 * Whether a popover still reads as rows without its lines, whether the shade is
 * seen, and whether the ring is found at a glance are the owner pass on the
 * artifact, in all seven palettes. What these rows hold is the other half: each
 * rule read out of the shipped sheet and run against the element the module
 * that builds the surface actually built, and the ring colour resolved per
 * palette. `:hover`, `:active` and `:focus-visible` match nothing here, so a row
 * about them takes the pseudo-class out of the selector and runs the rest.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { ThemeManager } from '../app/theme-manager';
import type { ContextCluster } from '../cluster/types';
import { createEditor } from '../editor/setup';
import type { PlatformIO } from '../platform/types';
import stylesCss from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, over, paletteTokens, resolveColour } from '../test-support/theme-colours';
import { setupAppearanceMenu } from './appearance-menu';
import { setupAssetsPopover } from './assets-popover';
import { setupClusterPopover } from './cluster-popover';
import { showConfirmDialog } from './confirm-dialog';
import { openEmojiPalette } from './emoji-palette';
import { openHeadingLevels } from './heading-levels';
import { openLanguagePopover } from './language-popover';
import { setupMenu } from './menu';
import { RECENT_MENU_ID } from './menu-recent';
import { setupToolbar } from './toolbar';

const rules = stylesheetRules(stylesCss);
/** Colours and radii never change inside a `@media` block of this sheet. */
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);
const paletteNames = [...palettes.keys()];

/** WCAG 1.4.11, for the mark that says which cell has focus. */
const NON_TEXT = 3;

const CLUSTER = {
  relatedCount: 1,
  entries: [
    {
      path: '/p/AGENTS.md',
      filename: 'AGENTS.md',
      kind: 'agents-md',
      direction: 'self',
      distance: 0,
      relativePath: 'AGENTS.md',
    },
  ],
} as unknown as ContextCluster;

/** Every surface of this issue, each as its own module built it, by name. */
const surfaces = new Map<string, HTMLElement>();

function found(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`nothing built ${selector}`);
  return element;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/**
 * Kept as a copy the moment it is built: opening one surface closes and empties
 * another, and a rule reaches a copy exactly as it reaches the original, since
 * none of the selectors of a surface kept this way looks above the surface
 * itself. The recent files card is the one whose rules do, and it is kept
 * inside a copy of the menu instead.
 */
function keep(name: string, element: HTMLElement): void {
  surfaces.set(name, element.cloneNode(true) as HTMLElement);
}

beforeAll(async () => {
  document.body.innerHTML = [
    shippedElement(shippedPage, '<header id="menubar"'),
    shippedElement(shippedPage, '<aside id="assets-popover"'),
    shippedElement(shippedPage, '<aside id="cluster-popover"'),
    shippedElement(shippedPage, '<aside id="appearance-popover"'),
    shippedElement(shippedPage, '<aside id="sidebar"'),
  ].join('');
  keep('menu card', found('#menu-dropdown'));
  keep('overflow list', found('#overflow-popover'));
  // The recent files card of #381 stands beside the menu and is one of them.
  setupMenu(
    new Proxy({}, { get: () => () => {} }) as never,
    () => ({ canUndo: true, canRedo: true }),
    () => ({}),
    () => ['/doc/a.md'],
  );
  found('#menu-toggle').click();
  found('#menu-section-file').click();
  found('#menu-open-recent').click();
  // Its rules are written under the menu, so it is kept inside a copy of it.
  const menuWithCard = found('#menu-dropdown').cloneNode(true) as HTMLElement;
  surfaces.set(
    'recent files card',
    menuWithCard.querySelector(`#${RECENT_MENU_ID}`) as HTMLElement,
  );
  found('#menu-toggle').click();
  keep('files panel card', found('#sidebar'));

  setupClusterPopover({
    getIO: async () => ({}) as unknown as PlatformIO,
    onOpenEntry: async () => {},
    onRefresh: async () => {},
    onNothingToShow: () => {},
  }).toggle(CLUSTER);
  await settle();
  keep('context files popover', found('#cluster-popover'));

  setupAssetsPopover({
    loadSummary: async () => ({ imagesInDocument: 1, folder: { kind: 'counted', otherFiles: 0 } }),
  }).toggle();
  await settle();
  keep('images popover', found('#assets-popover'));

  setupAppearanceMenu(new ThemeManager());
  found('#appearance-menu-trigger').click();
  keep('appearance popover', found('#appearance-popover'));

  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown('Some words');
  setupToolbar(editor.editor, {} as never);
  keep('floating toolbar', found('.floating-toolbar'));
  // Two grids need a frequent row, which is read from what was chosen before.
  localStorage.setItem('agented:emoji-frequent', JSON.stringify({ '😂': 2, '👍': 1 }));
  keep('emoji palette', openEmojiPalette(editor.editor).element);
  keep(
    'heading list',
    openHeadingLevels({
      anchor: document.createElement('button'),
      toolbar: found('.floating-toolbar'),
      current: null,
      onChoose: () => {},
    }).element,
  );
  keep(
    'language popover',
    openLanguagePopover({
      anchor: document.createElement('span'),
      initial: 'ts',
      onCommit: () => {},
      onCancel: () => {},
    }).element,
  );
  void showConfirmDialog({
    title: 'Unsaved changes',
    message: 'Save before closing?',
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save', value: 'save', variant: 'primary' },
    ],
  });
  await settle();
  keep('dialog', found('.dialog'));
});

afterEach(() => localStorage.removeItem('agented:emoji-frequent'));

/** The value the last rule reaching `el` gives `property`, in sheet order. */
function last(el: Element, property: string): string | undefined {
  return valuesReaching(atEveryWidth, el, property).at(-1);
}

/** The values the rules naming `state` give `property` on `el`, with `state` taken out. */
function inState(el: Element, state: string, property: string): string[] {
  return atEveryWidth
    .filter((rule) => rule.selector.includes(state))
    .filter((rule) => reaches(rule.selector.replaceAll(state, ''), el))
    .filter((rule) => rule.declarations.has(property))
    .map((rule) => (rule.declarations.get(property) as string).trim());
}

const inside = (surface: HTMLElement) => [...surface.querySelectorAll<HTMLElement>('*')];
const surface = (name: string) => surfaces.get(name) as HTMLElement;

function within(name: string, selector: string): HTMLElement {
  const element = surface(name).querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`the ${name} has no ${selector}`);
  return element;
}

const ONE_SIDE = ['border-top', 'border-bottom', 'border-left', 'border-right'];
const ONE_SIDE_ALL = [...ONE_SIDE, 'border-block-start', 'border-block-end'];

/**
 * A line inside a surface is a border on one side that is not transparent, or
 * an element filled with the border colour. A border all round, such as a
 * field or the outlined dialog buttons, is a control rather than a line.
 */
function interiorLines(el: HTMLElement): string[] {
  const sides = ONE_SIDE_ALL.flatMap((property) =>
    valuesReaching(atEveryWidth, el, property)
      .filter((value) => !/\b(none|transparent)\b/.test(value) && !/^0(px)?\b/.test(value))
      .map((value) => `${property}: ${value}`),
  );
  const fills = ['background', 'background-color']
    .flatMap((property) => valuesReaching(atEveryWidth, el, property))
    .filter((value) => value.includes('var(--border)'))
    .map((value) => `background: ${value}`);
  return [...sides, ...fills];
}

/**
 * Where each line was, one row each, so a row cannot pass on a surface that
 * built nothing. The menu card and the heading list are held at the same
 * places, the first since #362.
 */
const WHERE_THE_LINE_WAS: ReadonlyArray<readonly [string, string]> = [
  ['menu card', '.menu-section + .menu-panel + .menu-section'],
  ['heading list', '.heading-levels-option + .heading-levels-option'],
  ['emoji palette', '.emoji-palette-grid + .emoji-palette-grid'],
  ['appearance popover', '.appearance-option + .appearance-section-label'],
  ['context files popover', '.cluster-popover-header'],
  ['context files popover', '.cluster-popover-footer'],
  ['images popover', '.cluster-popover-header'],
];

describe('no line inside a floating surface (#375)', () => {
  it.each(WHERE_THE_LINE_WAS)('%s: no line at %s', (name, where) => {
    // A line between two rows is drawn by one of them: below the first or
    // above the second, so both are read.
    const row = within(name, where);
    const pair = [row.previousElementSibling as HTMLElement | null, row];
    const lines = pair.flatMap((el) =>
      el ? interiorLines(el).map((line) => `${el.className}: ${line}`) : [],
    );
    expect(lines).toEqual([]);
  });
});

/** A shade as the sheet spells it, with the stacked form `linear-gradient(x, x)` read as `x`. */
function shade(value: string): string {
  const stacked = /^linear-gradient\((var\(--[\w-]+\)),\s*\1\)$/.exec(value);
  return stacked ? stacked[1] : value;
}

/** Every shade and every line a `state` rule gives an element of the surface. */
function drawnIn(name: string, state: string): { shades: string[]; lines: string[] } {
  const shades = new Set<string>();
  const lines: string[] = [];
  for (const el of inside(surface(name))) {
    for (const property of ['background', 'background-color', 'background-image']) {
      for (const value of inState(el, state, property)) shades.add(shade(value));
    }
    for (const property of ['border', 'border-color', ...ONE_SIDE, 'box-shadow', 'outline']) {
      for (const value of inState(el, state, property)) lines.push(`${property}: ${value}`);
    }
  }
  return { shades: [...shades], lines };
}

describe('one hover shade, and no line under the pointer (#375)', () => {
  it.each([
    'menu card',
    'recent files card',
    'floating toolbar',
    'heading list',
    'emoji palette',
    'appearance popover',
    'context files popover',
    'dialog',
  ])('%s shades what is under the pointer with the hover overlay alone', (name) => {
    const drawn = drawnIn(name, ':hover');
    expect(drawn.shades).toEqual(['var(--hover-overlay)']);
    expect(drawn.lines).toEqual([]);
  });
});

describe('Refresh draws no outline, and hover and pressed carry the state (#375)', () => {
  const refresh = () => within('context files popover', '.cluster-popover-refresh');

  it('keeps a border pixel, drawn transparent, so the button keeps its size', () => {
    expect(last(refresh(), 'border')).toBe('1px solid transparent');
    expect(last(refresh(), 'border-color')).toBeUndefined();
  });

  it('shades it with the hover overlay under the pointer and while pressed', () => {
    expect(inState(refresh(), ':hover', 'background')).toEqual(['var(--hover-overlay)']);
    expect(inState(refresh(), ':active', 'background')).toEqual(['var(--hover-overlay)']);
  });
});

describe('the emoji that has keyboard focus wears an accent ring (#375)', () => {
  const cell = () => within('emoji palette', '.emoji-palette-option');
  const ring = () => {
    const outline = inState(cell(), ':focus-visible', 'outline');
    if (outline.length !== 1) throw new Error(`${outline.length} focus outlines on an emoji`);
    return outline[0];
  };

  it('draws a 2 px ring inside the cell, and no fill', () => {
    expect(ring()).toBe('2px solid var(--accent)');
    expect(inState(cell(), ':focus-visible', 'outline-offset')).toEqual(['-2px']);
    expect(inState(cell(), ':focus-visible', 'background')).toEqual([]);
  });

  it.each(
    paletteNames,
  )('%s: the ring stands off the palette at 3, and off a cell under the pointer', (name) => {
    // 3.41 to 7.49 on the palette and 3.16 to 6.73 on a hovered cell, measured
    // on the owner decision of 2026-09-19.
    const tokens = palettes.get(name) as Map<string, string>;
    const colour = resolveColour(/var\(--[\w-]+\)/.exec(ring())?.[0] ?? 'none', tokens);
    const ground = resolveColour(last(surface('emoji palette'), 'background') as string, tokens);
    const hovered = over(resolveColour(inState(cell(), ':hover', 'background')[0], tokens), ground);

    expect(contrast(colour, ground), name).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrast(colour, hovered), name).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

describe('one corner radius (#375)', () => {
  it('rounds every floating surface, the dialog and the files panel card at 8 px', () => {
    // The toast is not one of them, by the owner decision on #375.
    const radii = Object.fromEntries(
      [...surfaces].map(([name, el]) => [name, last(el, 'border-radius')]),
    );
    expect(radii).toEqual(Object.fromEntries([...surfaces.keys()].map((name) => [name, '8px'])));
  });
});
