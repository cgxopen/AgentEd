/**
 * Issue #373 - the search panel draws no line under it and no box on its
 * buttons at rest; hover and pressed carry the state, and the arrows and the
 * cross are drawn.
 *
 * **Said at the head: colour, size and hover are not observable here.**
 * happy-dom paints nothing, lays out nothing and has no pointer. Whether the
 * panel reads as one strip with the header, whether a button with no frame
 * still reads as one, and how large the cross looks are the owner pass on the
 * artifact, in all seven palettes. What these rows hold is the pair the pass
 * cannot check: the rule, read out of the sheet, and the element the shipped
 * markup renders, joined by running the one against the other. `:hover` and
 * `:active` match nothing without a pointer, so a row that asks about them takes
 * the pseudo-class out of the selector and runs the rest.
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

/** WCAG 1.4.11, for a drawn glyph that is the whole of a control. */
const NON_TEXT = 3;
/** WCAG 1.4.3, for a 12 px label. */
const TEXT = 4.5;

/** The buttons of the panel, which took one form at #373. */
const BUTTONS = [
  'search-find-prev',
  'search-find-next',
  'search-close',
  'search-replace-single',
  'search-replace-all',
];
const TOGGLES = ['search-toggle-case', 'search-toggle-word', 'search-toggle-regex'];
const DRAWN = ['search-find-prev', 'search-find-next', 'search-close'];

beforeEach(() => {
  document.body.innerHTML = shippedElement(shippedPage, '<div id="search-panel"');
});

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped search panel has no #${id}`);
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

/** A colour expression painted over a stack of grounds, bottom first. */
function paint(tokens: ReadonlyMap<string, string>, layers: readonly string[]): Rgba {
  let out = resolveColour(layers[0], tokens);
  for (const layer of layers.slice(1)) out = over(resolveColour(layer, tokens), out);
  return out;
}

describe('no line under the panel and no box at rest (#373)', () => {
  it('draws no line under the panel', () => {
    const panel = element('search-panel');
    for (const property of ['border', 'border-bottom', 'border-block-end']) {
      expect(valuesReaching(rules, panel, property), property).toEqual([]);
    }
  });

  it('gives every button of the panel a transparent border and no fill', () => {
    for (const id of BUTTONS) {
      const el = element(id);
      expect(last(el, 'border'), id).toBe('1px solid transparent');
      expect(last(el, 'border-color'), id).toBeUndefined();
      expect(last(el, 'background'), id).toBe('none');
    }
  });

  it('keeps the border on the two fields, which are fields and not buttons', () => {
    for (const id of ['search-input', 'search-replace-input']) {
      expect(last(element(id), 'border'), id).toBe('1px solid var(--border)');
    }
  });
});

describe('hover and pressed carry the state, one shade (#373)', () => {
  it('shades every button with the hover overlay under the pointer and pressed', () => {
    for (const id of BUTTONS) {
      const el = element(id);
      for (const state of [':hover', ':active']) {
        expect(inState(el, state, 'background'), `${id} ${state}`).toEqual([
          'var(--hover-overlay)',
        ]);
        expect(inState(el, state, 'border-color'), `${id} ${state}`).toEqual([]);
      }
    }
  });

  it('shades the three toggles with the same overlay under the pointer', () => {
    for (const id of TOGGLES) {
      expect(inState(element(id), ':hover', 'background'), id).toEqual(['var(--hover-overlay)']);
    }
  });

  it('gives a disabled button no shade, the disabled rule coming later at the same weight', () => {
    // A button is disabled only while the regex does not parse.
    const disabledRule = atEveryWidth.findIndex(
      (rule) => rule.selector.includes(':disabled') && rule.selector.includes('.search-nav'),
    );
    const shadeRule = atEveryWidth.findIndex(
      (rule) => rule.selector.includes('.search-nav:hover') && rule.selector.includes(':active'),
    );
    expect(disabledRule).toBeGreaterThan(shadeRule);
    expect(atEveryWidth[disabledRule].declarations.get('background')).toBe('none');
    expect(atEveryWidth[disabledRule].declarations.get('opacity')).toBe('0.45');
  });
});

/** The points of a path written as `M x y x y ...` segments, in order. */
function points(d: string): { x: number; y: number }[] {
  const numbers = d.replace(/M/g, ' ').trim().split(/\s+/).map(Number);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push({ x: numbers[i], y: numbers[i + 1] });
  return out;
}

describe('the arrows and the cross are drawn (#373)', () => {
  it('draws each of the three as one hidden SVG in the text colour, with no typed glyph', () => {
    for (const id of DRAWN) {
      const button = element(id);
      const svgs = button.querySelectorAll('svg');
      expect(svgs, id).toHaveLength(1);
      expect(svgs[0].getAttribute('aria-hidden'), id).toBe('true');
      expect(svgs[0].getAttribute('stroke'), id).toBe('currentColor');
      expect(svgs[0].getAttribute('viewBox'), id).toBe('0 0 12 12');
      expect(button.textContent?.trim(), id).toBe('');
    }
  });

  it('draws the arrows at 12 px and the cross at 10 px, the sizes the owner chose', () => {
    // The cascade, not sheet order alone: `.search-close .search-icon` outranks
    // `.search-icon`, (0,2,0) against (0,1,0), and comes after it.
    const size = { 'search-find-prev': '12px', 'search-find-next': '12px', 'search-close': '10px' };
    for (const [id, px] of Object.entries(size)) {
      const svg = element(id).querySelector('svg') as SVGElement;
      expect(last(svg, 'width'), id).toBe(px);
      expect(last(svg, 'height'), id).toBe(px);
    }
  });

  it('draws the three with one stroke weight on screen', () => {
    // A drawing scaled into a smaller box draws a thinner line, so the cross
    // carries a heavier stroke in its viewBox: 1.8 of 12 at 10 px is the 1.5 px
    // of the arrows at 12. One weight is the #330 rule for drawn symbols.
    const onScreen = DRAWN.map((id) => {
      const svg = element(id).querySelector('svg') as SVGElement;
      const box = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
      const width = Number.parseFloat(last(svg, 'width') ?? '');
      return Number(svg.getAttribute('stroke-width')) * (width / box);
    });
    for (const weight of onScreen) expect(weight).toBeCloseTo(1.5, 5);
  });

  it('points Previous up and Next down', () => {
    // The #286 shape: two drawn glyphs that could trade places with every other
    // row green. A chevron points where its middle point is, above its two ends
    // or below them.
    const chevron = (id: string) => {
      const d = element(id).querySelector('path')?.getAttribute('d') ?? '';
      const [start, middle, end] = points(d);
      return { middle: middle.y, top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) };
    };
    const prev = chevron('search-find-prev');
    const next = chevron('search-find-next');
    expect(prev.middle, 'Previous points up').toBeLessThan(prev.top);
    expect(next.middle, 'Next points down').toBeGreaterThan(next.bottom);
  });

  it('names each drawn button, since the drawing says nothing to a screen reader', () => {
    expect(element('search-find-prev').getAttribute('aria-label')).toBe('Previous');
    expect(element('search-find-next').getAttribute('aria-label')).toBe('Next');
    expect(element('search-close').getAttribute('aria-label')).toBe('Close search');
  });
});

describe('what the state rests on stays readable, per palette (#373)', () => {
  it.each(paletteNames)('%s: the drawn glyphs stand off the panel, at rest and shaded', (name) => {
    const tokens = palettes.get(name)!;
    const ground = last(element('search-panel'), 'background');
    if (ground === undefined) throw new Error('no rule gives the panel a background');
    for (const id of DRAWN) {
      const el = element(id);
      const ink = last(el, 'color');
      if (ink === undefined) throw new Error(`no rule gives #${id} a colour`);
      const shade = inState(el, ':hover', 'background')[0];
      const rest = contrast(resolveColour(ink, tokens), paint(tokens, [ground]));
      const shaded = contrast(resolveColour(ink, tokens), paint(tokens, [ground, shade]));
      expect(rest, `#${id} at rest in ${name}`).toBeGreaterThanOrEqual(NON_TEXT);
      expect(shaded, `#${id} shaded in ${name}`).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it.each(paletteNames)('%s: the Replace labels are readable at rest', (name) => {
    const tokens = palettes.get(name)!;
    const ground = last(element('search-panel'), 'background') as string;
    for (const id of ['search-replace-single', 'search-replace-all']) {
      const ink = last(element(id), 'color') as string;
      const ratio = contrast(resolveColour(ink, tokens), paint(tokens, [ground]));
      expect(ratio, `#${id} in ${name}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it.each(paletteNames)('%s: a disabled button stays apart from an enabled one', (name) => {
    // With the border gone, opacity is the whole of the difference. Measured on
    // #373 at 3.42 to 6.03 across the seven palettes; held at 3.4, so a lighter
    // opacity turns a row red rather than blurring the two states.
    const tokens = palettes.get(name)!;
    const ground = paint(tokens, [last(element('search-panel'), 'background') as string]);
    const button = element('search-replace-all');
    const ink = resolveColour(last(button, 'color') as string, tokens);
    (button as HTMLButtonElement).disabled = true;
    const opacity = Number(last(button, 'opacity'));
    const faded = over({ ...ink, a: ink.a * opacity }, ground);
    expect(contrast(over(ink, ground), faded)).toBeGreaterThanOrEqual(3.4);
  });
});

describe('a pressed toggle: a pale tint, a readable label, an accent border (#373)', () => {
  /** The three toggles, each pressed. */
  function pressedToggles(): HTMLElement[] {
    return TOGGLES.map((id) => {
      const el = element(id);
      el.setAttribute('aria-pressed', 'true');
      return el;
    });
  }

  // One property per row, so that a reversal of one declaration reddens the
  // rows about it and not the rows about its neighbours.
  it('fills a pressed toggle with the pale tint', () => {
    for (const el of pressedToggles()) {
      expect(last(el, 'background'), el.id).toBe(
        'color-mix(in srgb, var(--accent) 15%, var(--bg))',
      );
    }
  });

  it('writes a pressed label in the text colour', () => {
    for (const el of pressedToggles()) expect(last(el, 'color'), el.id).toBe('var(--text)');
  });

  it('borders a pressed toggle in the accent', () => {
    for (const el of pressedToggles()) {
      expect(last(el, 'border-color'), el.id).toBe('var(--accent)');
    }
  });

  it('falls back to the panel colour where the tint is dropped', () => {
    // An engine that cannot parse `color-mix()` drops the declaration, and the
    // background is then the one the resting rule gives every toggle.
    const resting = atEveryWidth.find((rule) => rule.selector === '.search-toggle');
    expect(resting?.declarations.get('background')).toBe('transparent');
  });

  it.each(paletteNames)('%s: the pressed label reads at 4.5 on its fill', (name) => {
    const tokens = palettes.get(name)!;
    const ground = last(element('search-panel'), 'background') as string;
    for (const el of pressedToggles()) {
      const fill = paint(tokens, [ground, last(el, 'background') as string]);
      const label = contrast(resolveColour(last(el, 'color') as string, tokens), fill);
      expect(label, `#${el.id} in ${name}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it.each(paletteNames)('%s: the border says pressed at 3 against the panel', (name) => {
    const tokens = palettes.get(name)!;
    const ground = paint(tokens, [last(element('search-panel'), 'background') as string]);
    for (const el of pressedToggles()) {
      const edge = contrast(resolveColour(last(el, 'border-color') as string, tokens), ground);
      expect(edge, `#${el.id} in ${name}`).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });
});

describe('the count cannot squeeze the find field (#373)', () => {
  it('caps the count and cuts it with an ellipsis', () => {
    const count = element('search-count');
    expect(last(count, 'max-width')).toBe('12em');
    expect(last(count, 'overflow')).toBe('hidden');
    expect(last(count, 'text-overflow')).toBe('ellipsis');
    expect(last(count, 'white-space')).toBe('nowrap');
  });
});
