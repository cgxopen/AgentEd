/**
 * Issue #374 - one paler band behind an open menu section, the metadata strip
 * and the metadata field while it has focus, and an accent line that says the
 * field has focus.
 *
 * **Said at the head: colour and focus are not observable here.** happy-dom
 * paints nothing and draws no focus. Whether the band reads as paler, whether
 * a hovered entry stands off it, and whether the accent line is seen are the
 * owner pass on the artifact, in all seven palettes. What these rows hold is
 * the pair the pass cannot check: each rule read out of the sheet, run against
 * the element the shipped markup renders, and its colour resolved per palette.
 * `:focus` and `:hover` match nothing here, so a row about them takes the
 * pseudo-class out of the selector and runs the rest.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import stylesCss from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import {
  contrast,
  over,
  paletteTokens,
  type Rgba,
  resolveColour,
} from '../test-support/theme-colours';

const rules = stylesheetRules(stylesCss);
/** Colours never change inside a `@media` block of this sheet. */
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);
const paletteNames = [...palettes.keys()];

/** WCAG 1.4.3, for the 12 px label of the strip. */
const TEXT = 4.5;
/** WCAG 1.4.11, for the line that says the field has focus. */
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
const strip = () => one('#frontmatter-panel');
const menuPanels = () => [...document.querySelectorAll<HTMLElement>('.menu-panel')];

/** A colour painted over the page, as the band and the field are. */
function onPage(tokens: ReadonlyMap<string, string>, colour: string): Rgba {
  return over(resolveColour(colour, tokens), resolveColour('var(--bg)', tokens));
}

describe('one band, one address (#374)', () => {
  // One row per surface, so a surface that takes a value of its own reddens its
  // own row and no other.
  it('fills every menu section with the band', () => {
    const panels = menuPanels();
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) expect(last(panel, 'background'), panel.id).toBe('var(--band)');
  });

  it('fills the metadata strip with the band', () => {
    expect(last(strip(), 'background')).toBe('var(--band)');
  });

  it('fills the metadata field with the band while it has focus', () => {
    expect(inState(field(), ':focus', 'background')).toEqual(['var(--band)']);
  });

  it('defines the band once, from the two tokens every palette has', () => {
    const defining = atEveryWidth.filter((rule) => rule.declarations.has('--band'));
    expect(defining.map((rule) => rule.selector)).toEqual([':root']);
    expect(defining[0].declarations.get('--band')).toBe(
      'color-mix(in srgb, var(--surface) 40%, var(--bg))',
    );
  });

  it('keeps the field at rest on the page colour', () => {
    expect(last(field(), 'background')).toBe('var(--bg)');
  });
});

describe('what stands on the band, per palette (#374)', () => {
  it.each(paletteNames)('%s: the band is paler than --surface was', (name) => {
    const tokens = palettes.get(name)!;
    const page = resolveColour('var(--bg)', tokens);
    const band = contrast(onPage(tokens, 'var(--band)'), page);
    const surface = contrast(onPage(tokens, 'var(--surface)'), page);
    expect(band, name).toBeLessThan(surface);
  });

  it.each(paletteNames)('%s: the Metadata label reads at 4.5 on the band', (name) => {
    const tokens = palettes.get(name)!;
    const label = one('#frontmatter-panel summary');
    const ink = resolveColour(last(label, 'color') as string, tokens);
    const ground = onPage(tokens, last(strip(), 'background') as string);
    expect(contrast(ink, ground), name).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(paletteNames)('%s: a hovered entry stands off the band as it did', (name) => {
    // The overlay composes over the band, so its step barely moves with it:
    // 1.164 to 1.443 across the seven, held at 1.16.
    const tokens = palettes.get(name)!;
    const entry = one('#menu-find');
    const shade = inState(entry, ':hover:not(:disabled)', 'background-color')[0];
    const band = onPage(tokens, last(menuPanels()[0], 'background') as string);
    const hovered = over(resolveColour(shade, tokens), band);
    expect(contrast(hovered, band), name).toBeGreaterThanOrEqual(1.16);
  });
});

describe('the field says it has focus (#374)', () => {
  it('draws a 3 px accent line on the left edge while it has focus', () => {
    expect(inState(field(), ':focus', 'box-shadow')).toEqual(['inset 3px 0 0 var(--accent)']);
  });

  it.each(paletteNames)('%s: the line stands off the band at 3', (name) => {
    const tokens = palettes.get(name)!;
    const line = inState(field(), ':focus', 'box-shadow')[0];
    const colour = /var\(--[\w-]+\)/.exec(line ?? '')?.[0];
    if (colour === undefined) throw new Error('no colour in the focus line');
    const band = onPage(tokens, inState(field(), ':focus', 'background')[0]);
    expect(contrast(resolveColour(colour, tokens), band), name).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

describe('the line under the metadata panel, only while it is open (#374)', () => {
  it('draws no line while the panel is folded, and keeps its pixel', () => {
    const panel = strip();
    panel.removeAttribute('open');
    expect(last(panel, 'border-bottom')).toBe('1px solid transparent');
    expect(last(panel, 'border-bottom-color')).toBeUndefined();
  });

  it('draws the line in --border while the panel is open', () => {
    const panel = strip();
    panel.setAttribute('open', '');
    expect(last(panel, 'border-bottom-color')).toBe('var(--border)');
  });

  it.each(paletteNames)('%s: the open line stands off the page at 3', (name) => {
    const tokens = palettes.get(name)!;
    const panel = strip();
    panel.setAttribute('open', '');
    const line = resolveColour(last(panel, 'border-bottom-color') as string, tokens);
    expect(contrast(line, resolveColour('var(--bg)', tokens)), name).toBeGreaterThanOrEqual(
      NON_TEXT,
    );
  });
});
