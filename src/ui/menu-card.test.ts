/**
 * #362 — the menu card: no line between the section headers, and the section
 * arrow on the left, drawn as an inline SVG, pointing right while its section
 * is closed and down while it is open.
 *
 * **Said first: colour and layout are not observable in this harness.** What
 * these rows hold is the rule read out of the shipped stylesheet and run
 * against the element the shipped page carries, and the markup itself. How the
 * card looks, and whether the arrow and the indent read right, is the owner
 * pass on the artifact. The contrast of the arrow is computed per palette from
 * the tokens, the #321 instrument.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import stylesCss from '../styles.css?raw';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, over, paletteTokens, resolveColour } from '../test-support/theme-colours';
import { setupMenu } from './menu';

const rules = stylesheetRules(stylesCss);
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);

/** The last value a property takes on `target` among rules whose selector reaches it. */
function last(target: Element, property: string): string | undefined {
  return valuesReaching(atEveryWidth, target, property).at(-1);
}

function arrowOf(header: Element): SVGElement {
  const arrow = header.querySelector<SVGElement>('svg.menu-chevron');
  if (!arrow) throw new Error(`#${header.id} has no arrow`);
  return arrow;
}

/** The page's `<header>`, which holds the menu. Mounting it all would send happy-dom fetching. */
function mount(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  document.body.innerHTML = shippedPage.slice(open, close + '</header>'.length);
}

function headers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#menu-dropdown .menu-section')];
}

beforeEach(mount);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('no line between the section headers (#362)', () => {
  it('draws nothing on any header, above or below it', () => {
    expect(headers()).toHaveLength(5);
    for (const header of headers()) {
      for (const property of ['background-image', 'border-top', 'border-bottom', 'box-shadow']) {
        expect(valuesReaching(atEveryWidth, header, property), `${header.id} ${property}`).toEqual(
          [],
        );
      }
    }
  });
});

describe('the section arrow is on the left, drawn, and points right until it opens (#362)', () => {
  it('is an inline SVG in currentColor, before the name, hidden from a screen reader', () => {
    for (const header of headers()) {
      const arrow = arrowOf(header);
      expect(header.firstElementChild, header.id).toBe(arrow);
      expect(arrow.getAttribute('stroke'), header.id).toBe('currentColor');
      expect(arrow.getAttribute('aria-hidden'), header.id).toBe('true');
      expect(header.textContent?.trim(), header.id).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it('points right while its section is closed, and down while it is open', () => {
    // The drawing points right; a closed header gives it no turn, an open one a
    // quarter. Driven through the real accordion, so the state is the one the
    // menu writes rather than one set by hand.
    setupMenu(
      new Proxy({}, { get: () => () => {} }) as never,
      () => ({ canUndo: true, canRedo: true }),
      () => ({}),
    );
    const edit = document.getElementById('menu-section-edit') as HTMLElement;
    const turn = () => last(arrowOf(edit), 'transform');

    document.getElementById('menu-toggle')?.click();
    expect(edit.getAttribute('aria-expanded')).toBe('false');
    expect(turn()).toBeUndefined();
    const path = arrowOf(edit).querySelector('path')?.getAttribute('d');
    expect(path, 'the drawing points right: out to the right and back').toBe(
      'M6 3.5 10.5 8 6 12.5',
    );

    edit.click();
    expect(edit.getAttribute('aria-expanded')).toBe('true');
    expect(turn()).toBe('rotate(90deg)');
  });

  it('keeps the entries deeper than the name, so header and entries read as a tree', () => {
    // Read from the stylesheet, not rendered: the name starts after the
    // header padding, the arrow and the gap; an entry at its own padding.
    const header = headers()[1];
    const entry = document.getElementById('menu-find') as HTMLElement;
    const px = (value: string | undefined) => Number.parseFloat(value ?? 'NaN');
    const nameStart =
      px(last(header, 'padding-left')) +
      px(last(arrowOf(header), 'width')) +
      px(last(header, 'gap'));
    const entryStart = px(last(entry, 'padding-left'));

    expect(nameStart).toBe(18);
    expect(entryStart).toBe(28);
    expect(entryStart).toBeGreaterThan(nameStart);
  });

  it.each([
    ...palettes.keys(),
  ])('%s: the arrow stands off its row at 3 to 1, at rest and under the pointer', (name) => {
    // A non-text mark, so 1.4.11: 3 to 1. The ground is the menu card, `--bg`,
    // and under the pointer the shade the rule reaching a header gives it.
    const tokens = palettes.get(name) as Map<string, string>;
    const header = headers()[0];
    const colour = resolveColour(last(arrowOf(header), 'color') as string, tokens);
    const card = resolveColour(
      last(document.getElementById('menu-dropdown') as Element, 'background') as string,
      tokens,
    );
    const shadeRule = atEveryWidth.find(
      (rule) =>
        rule.selector.includes(':hover') &&
        reaches(rule.selector.replaceAll(':hover', '').replaceAll(':not(:disabled)', ''), header) &&
        rule.declarations.has('background-color'),
    );
    const shade = resolveColour(shadeRule?.declarations.get('background-color') as string, tokens);

    expect(contrast(colour, card)).toBeGreaterThanOrEqual(3);
    expect(contrast(colour, over(shade, card))).toBeGreaterThanOrEqual(3);
  });

  it('turns with the slide for everyone, and not at all for someone who asked for less motion', () => {
    const arrow = arrowOf(headers()[0]);
    expect(last(arrow, 'transition')).toMatch(/\btransform\b/);
    const reduced = rules.filter(
      (rule) =>
        rule.conditions.some((c) => /prefers-reduced-motion:\s*reduce/.test(c)) &&
        reaches(rule.selector, arrow),
    );
    expect(reduced.map((rule) => rule.declarations.get('transition'))).toContain('none');
  });
});
