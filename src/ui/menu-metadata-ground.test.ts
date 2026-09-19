/**
 * Issue #374 - an open menu section and the metadata panel draw no band; the
 * metadata field says it has focus with an accent line; and the line under the
 * metadata panel is drawn only while the panel is open.
 *
 * **Said at the head: colour and focus are not observable here.** happy-dom
 * paints nothing and draws no focus. Whether an open section still reads as
 * open, whether the folded metadata title stands apart from the document, and
 * whether the accent line is seen are the owner pass on the artifact, in all
 * seven palettes. What these rows hold is the pair the pass cannot check: each
 * rule read out of the sheet, run against the element the shipped markup
 * renders, and its colour resolved per palette. `:focus` and `:hover` match
 * nothing here, so a row about them takes the pseudo-class out of the selector
 * and runs the rest.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import stylesCss from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, over, paletteTokens, resolveColour } from '../test-support/theme-colours';

const rules = stylesheetRules(stylesCss);
/** Colours never change inside a `@media` block of this sheet. */
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);
const paletteNames = [...palettes.keys()];

/** WCAG 1.4.3, for the 12 px label of the metadata panel. */
const TEXT = 4.5;
/** WCAG 1.4.11, for the lines that say focus and open. */
const NON_TEXT = 3;

beforeEach(() => {
  document.body.innerHTML = [
    shippedElement(shippedPage, '<nav id="menu-dropdown"'),
    shippedElement(shippedPage, '<details id="frontmatter-panel"'),
  ].join('');
});

function one(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`the shipped markup has no ${selector}`);
  return found;
}

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

const field = () => one('#frontmatter-input');
const panel = () => one('#frontmatter-panel');
const menuPanels = () => [...document.querySelectorAll<HTMLElement>('.menu-panel')];
const page = (tokens: ReadonlyMap<string, string>) => resolveColour('var(--bg)', tokens);

describe('no band (#374)', () => {
  // One row per surface, so a band put back on one surface reddens its own row.
  it('draws no fill behind an open menu section', () => {
    const panels = menuPanels();
    expect(panels.length).toBeGreaterThan(0);
    for (const section of panels) expect(last(section, 'background'), section.id).toBe('none');
  });

  it('stands the metadata panel on the page colour', () => {
    expect(last(panel(), 'background')).toBe('var(--bg)');
  });

  it('keeps the metadata field on the page colour, at rest and while it has focus', () => {
    expect(last(field(), 'background')).toBe('var(--bg)');
    expect(inState(field(), ':focus', 'background')).toEqual([]);
    expect(inState(field(), ':focus', 'background-color')).toEqual([]);
  });
});

describe('what stands on the page colour, per palette (#374)', () => {
  it.each(paletteNames)('%s: the Metadata label reads at 4.5', (name) => {
    const tokens = palettes.get(name)!;
    const label = one('#frontmatter-panel summary');
    const ink = resolveColour(last(label, 'color') as string, tokens);
    const ground = over(resolveColour(last(panel(), 'background') as string, tokens), page(tokens));
    expect(contrast(ink, ground), name).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(paletteNames)('%s: a hovered entry stands off the menu card', (name) => {
    // 1.165 to 1.429 across the seven, held at 1.16.
    const tokens = palettes.get(name)!;
    const entry = one('#menu-find');
    const shade = inState(entry, ':hover:not(:disabled)', 'background-color')[0];
    const card = resolveColour(last(one('#menu-dropdown'), 'background') as string, tokens);
    const ground = over(resolveColour(last(menuPanels()[0], 'background') as string, tokens), card);
    const hovered = over(resolveColour(shade, tokens), ground);
    expect(contrast(hovered, ground), name).toBeGreaterThanOrEqual(1.16);
  });
});

describe('the field says it has focus (#374)', () => {
  it('draws a 3 px accent line on the left edge while it has focus', () => {
    expect(inState(field(), ':focus', 'box-shadow')).toEqual(['inset 3px 0 0 var(--accent)']);
  });

  it.each(paletteNames)('%s: the line stands off the field at 3', (name) => {
    const tokens = palettes.get(name)!;
    const line = inState(field(), ':focus', 'box-shadow')[0];
    const colour = /var\(--[\w-]+\)/.exec(line ?? '')?.[0];
    if (colour === undefined) throw new Error('no colour in the focus line');
    const ground = resolveColour(last(field(), 'background') as string, tokens);
    expect(contrast(resolveColour(colour, tokens), ground), name).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

describe('the line under the metadata panel, only while it is open (#374)', () => {
  it('draws no line while the panel is folded, and keeps its pixel', () => {
    panel().removeAttribute('open');
    expect(last(panel(), 'border-bottom')).toBe('1px solid transparent');
    expect(last(panel(), 'border-bottom-color')).toBeUndefined();
  });

  it('draws the line in --border while the panel is open', () => {
    panel().setAttribute('open', '');
    expect(last(panel(), 'border-bottom-color')).toBe('var(--border)');
  });

  it.each(paletteNames)('%s: the open line stands off the page at 3', (name) => {
    const tokens = palettes.get(name)!;
    panel().setAttribute('open', '');
    const line = resolveColour(last(panel(), 'border-bottom-color') as string, tokens);
    expect(contrast(line, page(tokens)), name).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
