/**
 * Issue #351 — the header and the open search panel take the colour of the
 * document, and the line under the header goes.
 *
 * **Said first: colour is not observable in this harness.** happy-dom paints
 * nothing, so whether the window reads as one surface from the frame to the
 * text is the owner pass on the artifact, in all seven palettes, and nothing
 * here. What these rows hold is the rule: each declaration is read out of the
 * shipped stylesheet and its selector run against the element the shipped page
 * carries. The frame half of that decision, the native frame read from the
 * same token, went with #366: on Windows the header is the title bar, and
 * elsewhere the system draws its own.
 */
import { describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, paletteTokens, resolveColour } from '../test-support/theme-colours';

const rules = stylesheetRules(stylesCss);
/** Colours never change inside a `@media` block of this sheet; see `theme-border-contrast.test.ts`. */
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);

/**
 * An element of the shipped page's body, parsed rather than mounted, and without
 * the head and the module script: happy-dom fetches a stylesheet link even in a
 * parsed document.
 */
function shippedElement(selector: string): Element {
  const body = shippedPage.slice(shippedPage.indexOf('<body>'), shippedPage.indexOf('<script'));
  const page = new DOMParser().parseFromString(body, 'text/html');
  const found = page.querySelector(selector);
  if (!found) throw new Error(`the shipped page has no ${selector}`);
  return found;
}

/** The value the last rule reaching `target` gives `property`, in sheet order. */
function last(target: Element, property: string): string | undefined {
  return valuesReaching(atEveryWidth, target, property).at(-1);
}

describe('the header is the document colour with no line under it (#351)', () => {
  it('draws no line under the header', () => {
    const bottom = last(shippedElement('#menubar'), 'border-bottom');
    expect(bottom?.split(/\s+/).at(-1)).toBe('transparent');
  });

  it('keeps the border pixel, so the header keeps its 44 px at every scaling', () => {
    // Measured in Chromium: 43 CSS px at 100, 125, 150 and 200 per cent with
    // the border gone, and 44, 43.8, 43.67 and 44 with it. Every placement that
    // reads the header bottom was measured against the second set.
    const bottom = last(shippedElement('#menubar'), 'border-bottom');
    expect(bottom?.split(/\s+/)[0]).toBe('1px');
  });

  it('paints the open search panel with the colour the page is painted with', () => {
    const panel = shippedElement('#search-panel');
    panel.removeAttribute('hidden');

    expect(last(panel, 'background')).toBe(last(shippedElement('body'), 'background'));
  });

  it.each([
    ...palettes.keys(),
  ])('%s: a search toggle under the pointer still fills against the panel', (name) => {
    // The hover used to fill with `--bg`, which on a panel of `--bg` is no fill.
    const tokens = palettes.get(name) as Map<string, string>;
    const panel = shippedElement('#search-panel');
    panel.removeAttribute('hidden');
    const hovered = rules.find((rule) => rule.selector === '.search-toggle:hover');
    const fill = hovered?.declarations.get('background');
    const ground = last(panel, 'background');
    if (fill === undefined || ground === undefined) throw new Error('no fill or no panel ground');

    expect(resolveColour(fill, tokens)).not.toEqual(resolveColour(ground, tokens));
  });
});

describe('the files panel card is the document colour, and its border draws it (#358)', () => {
  it('paints the card with the colour the page is painted with', () => {
    const card = shippedElement('#sidebar');
    card.classList.remove('hidden');

    expect(last(card, 'background')).toBe(last(shippedElement('body'), 'background'));
  });

  it.each([
    ...palettes.keys(),
  ])('%s: the border stands off the card and the page at 3 to 1', (name) => {
    // With the fill on the page colour the border is the only edge the card
    // has, so its colour is read out of the sheet and held against the ground
    // it is drawn on. Measured on the built page: 3.19 to 3.54.
    const tokens = palettes.get(name) as Map<string, string>;
    const card = shippedElement('#sidebar');
    const border = last(card, 'border')?.match(/var\(--[\w-]+\)/)?.[0];
    const ground = last(card, 'background');
    if (border === undefined || ground === undefined) throw new Error('no border or no fill');

    expect(
      contrast(resolveColour(border, tokens), resolveColour(ground, tokens)),
    ).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The regression half: every rule the owner decision leaves on `--surface` —
 * the sections inside the hamburger menu, the floating toolbar, the metadata
 * panel, table header cells and inline code among them — is listed here, read
 * out of the sheet. The files panel card left the list with #358. A rule that moves off the token, or a new
 * one that takes it, changes this list, and the change is then a decision
 * rather than a side effect.
 */
describe('everything else stays on --surface (#351, #358)', () => {
  it('names --surface where it did, less the header, the search panel and the files card', () => {
    const onSurface = rules.flatMap((rule) =>
      [...rule.declarations]
        .filter(([, value]) => value.includes('var(--surface)'))
        .map(([property]) => `${rule.selector} { ${property} }`),
    );

    expect(onSurface).toEqual([
      // Inline code, in the default palette only: the six others give
      // `--code-inline-bg` a colour of their own, and none of them moves here.
      ':root { --code-inline-bg }',
      '.menu-panel { background }',
      '.frontmatter-panel { background }',
      '.frontmatter-panel textarea:focus { background }',
      // The search toggles and buttons left with #373, for the hover overlay.
      '.tiptap code { background }',
      '.tiptap table th { background }',
      '.dialog-actions button:hover { background }',
      '.floating-toolbar { background }',
      '.emoji-palette-option:hover,\n.emoji-palette-option:focus-visible { background }',
    ]);
  });
});
