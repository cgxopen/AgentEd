/**
 * Issue #332 — the buttons of the menubar take one outlined form.
 *
 * **Said at the head: how the bar reads is layout and look, and no row below
 * sees it.** happy-dom performs no layout, so whether the bar is crowded,
 * whether the frame reads as *this can be pressed*, and whether the one
 * remaining chip looks out of place are the owner pass on the artifact. The
 * figures that decided the shape were measured in Chromium against the built
 * page and are written on the issue.
 *
 * What these rows assert is the mechanism, which is what #330 learned to do
 * after a box matched by hand arrived unequal on another platform: **the same
 * declarations reach every member**, so the members are one form wherever they
 * are drawn, rather than several forms that agree on the machine the numbers
 * were taken on.
 *
 * They also hold the line on what the issue said it would not move: every
 * button keeps the state attribute, the tooltip and the accessible name it had.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { isOfferedInOverflow, overflowClone } from '../app/header-wiring';
import stylesCss from '../styles.css?raw';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';

const rules = stylesheetRules(stylesCss);
/**
 * The form is compared over the rules that apply at every width. The collapse
 * breakpoints also set `display`, on the members that leave the bar, and that
 * is a different fact with a row of its own below.
 */
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);

/** The page's `<header>`; mounting the document would send happy-dom fetching. */
function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped header has no #${id}`);
  return found;
}

/** Every button the issue named, plus the two ends #330 already framed. */
const FAMILY = [
  'menu-toggle',
  // The spell-check toggle left the bar for the Edit menu at #360.
  'indicator-search',
  'badge-images',
  'cluster-indicator',
  'overflow-toggle',
  'appearance-menu-trigger',
  // The files panel control, which took the last seat at #347.
  'sidebar-toggle',
];

/** The members whose whole content is a drawing, and are therefore square. */
const SQUARE = [
  'menu-toggle',
  'indicator-search',
  'overflow-toggle',
  'appearance-menu-trigger',
  'sidebar-toggle',
];

/** What the family rule owns for every member alike. */
const FORM = ['border', 'border-radius', 'display', 'align-items', 'justify-content', 'height'];

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = shippedHeaderMarkup();
});

describe('one rule gives every button in the bar its form', () => {
  it('reaches all of them with the same declarations', () => {
    const values = (id: string, property: string) =>
      valuesReaching(atEveryWidth, element(id), property).at(-1);
    for (const property of FORM) {
      const first = values(FAMILY[0], property);
      expect(first, `${property} reaches no member`).toBeDefined();
      for (const id of FAMILY) {
        expect(values(id, property), `${id} / ${property}`).toBe(first);
      }
    }
  });

  it('gives the drawing-only members a square and the labelled ones room for the label', () => {
    // The one property that cannot be shared: a 31px square around the words
    // of the image badge is not a thing that can exist, so width and the side padding
    // ride on the modifier the drawing-only members carry.
    for (const id of FAMILY) {
      const width = valuesReaching(rules, element(id), 'width').at(-1);
      const padding = valuesReaching(rules, element(id), 'padding').at(-1);
      if (SQUARE.includes(id)) {
        expect(width, id).toBe('31px');
        expect(padding, id).toBe('0');
      } else {
        expect(width, id).toBeUndefined();
        expect(padding, id).toBe('0 9px');
      }
    }
  });

  it('lets no member take its height from a font', () => {
    // The #330 defect in one line: a box a font arrives at is a different box
    // on every platform. Every member declares its height, so none of them is
    // a line box. A member may still set the size of its own label — the
    // «Images» badge does, at 12px — and that changes what is inside the frame
    // rather than the frame.
    for (const id of FAMILY) {
      expect(valuesReaching(rules, element(id), 'height').at(-1), id).toBe('31px');
    }
  });

  it('hovers all of them the same way, and stacks rather than replaces', () => {
    const hover = rules.filter((rule) => rule.selector.includes(':hover'));
    const shade = (el: Element) =>
      hover
        .filter((rule) => reaches(rule.selector.replaceAll(':hover', ''), el))
        .flatMap((rule) =>
          [rule.declarations.get('background'), rule.declarations.get('background-image')]
            .filter((value) => value !== undefined)
            .map((value) => (value as string).trim()),
        );
    for (const id of FAMILY) {
      expect(shade(element(id)), id).toEqual([
        'linear-gradient(var(--hover-overlay), var(--hover-overlay))',
      ]);
    }
  });

  it('gives the bar one distance, so no pair of neighbours sits further apart', () => {
    // The owner found this on the artifact and it measured 14px against the 6px
    // of every other pair: `#header-indicators` carried a `padding-right` of
    // its own, which is a second distance applying to exactly one pair — the
    // last item inside the group against the first one outside it. Which item
    // is last depends on what the document has, so the wide pair moved as the
    // bar filled. The row asserts the cause rather than the gap, since the
    // harness performs no layout: one `gap` on both rows of the bar, and no
    // padding on either container to add to it.
    const containers = ['.header-right', '#header-indicators'];
    const gaps = containers.map((selector) => {
      const el = document.querySelector(selector) as HTMLElement;
      return valuesReaching(atEveryWidth, el, 'gap').at(-1);
    });
    expect(gaps).toEqual(['6px', '6px']);
    for (const selector of containers) {
      const el = document.querySelector(selector) as HTMLElement;
      for (const property of ['padding', 'padding-right', 'padding-left', 'margin-right']) {
        const value = valuesReaching(atEveryWidth, el, property).at(-1);
        expect(value === undefined || value === '0', `${selector} / ${property}`).toBe(true);
      }
    }
  });

  it('draws every symbol in the family at one size and one weight', () => {
    // The magnifier was 14px of box against the 16px the others use, and drew
    // 11 by 11.25 px of ink against their 14 by 14 — a square button holding a
    // drawing a fifth smaller, which is what the owner saw as *not quite
    // square*. What is assertable here is the geometry the ink comes from: one
    // icon rule, one viewBox and one stroke. The ink itself was measured in
    // Chromium and is on the issue.
    const icons = SQUARE.map((id) => {
      const svg = element(id).querySelector('svg');
      if (!svg) throw new Error(`${id} holds no drawing`);
      return { id, svg };
    });
    for (const { id, svg } of icons) {
      expect(svg.getAttribute('class'), id).toBe('header-edge-icon');
      expect(svg.getAttribute('viewBox'), id).toBe('0 0 16 16');
      expect(svg.getAttribute('aria-hidden'), id).toBe('true');
      for (const property of ['width', 'height']) {
        expect(valuesReaching(atEveryWidth, svg, property).at(-1), `${id} / ${property}`).toBe(
          '16px',
        );
      }
    }
    // The dots are filled and the other three are stroked, so the weight that
    // has to agree is the weight of whatever each one draws with.
    const weight = (svg: Element) =>
      svg.getAttribute('stroke') === 'none'
        ? svg.getAttribute('fill')
        : svg.getAttribute('stroke-width');
    expect(icons.map(({ svg }) => weight(svg))).toEqual(['2', '2', 'currentColor', '2', '2']);
  });

  it('tells a readout from a button by how the box is filled, not by the box', () => {
    // Owner decision on the third artifact, and it replaced an earlier head in
    // which the readout was outlined too: an outline means it can be pressed, a
    // background means it cannot. So the box is shared and the fill is what
    // differs — which is the half a reader sees.
    const readout = element('count-readout');
    const badge = element('badge-metadata');
    // The image badge, a labelled button, since the spell-check toggle that
    // stood here left the bar at #360.
    const button = element('badge-images');
    const box = (el: Element, property: string) =>
      valuesReaching(atEveryWidth, el, property).at(-1);

    for (const property of ['height', 'border-radius', 'padding', 'display', 'align-items']) {
      expect(box(readout, property), `readout / ${property}`).toBe(box(button, property));
      expect(box(badge, property), `badge / ${property}`).toBe(box(button, property));
    }

    // The fill, which is the whole of the difference.
    for (const el of [readout, badge]) {
      expect(box(el, 'background'), 'a readout is filled').toBe('var(--hover-overlay)');
      expect(box(el, 'border'), 'a readout is not outlined').toBeUndefined();
    }
    expect(box(button, 'border')).toBe('1px solid var(--border)');
    expect(box(button, 'background')).toBe('none');
  });

  it('gives a readout nothing that says it can be pressed', () => {
    for (const id of ['count-readout', 'badge-metadata']) {
      const el = element(id);
      expect(el.tagName.toLowerCase(), id).not.toBe('button');
      expect(el.className, id).not.toMatch(/header-edge-button/);
      expect(el.getAttribute('tabindex'), id).toBeNull();
      const hovered = rules
        .filter((rule) => rule.selector.includes(':hover'))
        .some((rule) => reaches(rule.selector.replaceAll(':hover', ''), el));
      expect(hovered, id).toBe(false);
    }
    // `cursor: help` on the badge is the one exception and it is deliberate:
    // the badge says what it is on hover and has said so since R-C12.
    expect(valuesReaching(atEveryWidth, element('count-readout'), 'cursor')).toEqual([]);
  });

  it('keeps the counts themselves spans, inside that frame', () => {
    for (const id of ['token-number', 'token-unit', 'word-count', 'char-count']) {
      const el = element(id);
      expect(el.tagName.toLowerCase(), id).toBe('span');
      expect(el.parentElement?.id, id).toBe('count-readout');
      expect(el.className, id).not.toMatch(/header-frame|header-edge-button/);
    }
  });

  it('leaves the spans out of the family', () => {
    // R-C12 keeps the informative chips quiet; the frame is the reading rule
    // for what can be pressed, so nothing that cannot be pressed carries it.
    for (const id of ['token-number', 'token-unit', 'word-count', 'char-count', 'badge-metadata']) {
      const el = element(id);
      expect(el.tagName.toLowerCase(), id).toBe('span');
      expect(el.className, id).not.toMatch(/header-edge-button/);
    }
  });
});

describe('nothing the issue said it would not move has moved', () => {
  it('keeps every state attribute where it was', () => {
    // The spell-check toggle carried no state attribute and stated its state
    // in its text; it left the bar for the Edit menu at #360, where the entry
    // carries `aria-pressed` instead (`statusbar.test.ts`).
    for (const id of ['indicator-search', 'badge-images', 'cluster-indicator', 'overflow-toggle']) {
      expect(element(id).getAttribute('aria-expanded'), id).toBe('false');
    }
  });

  it('keeps every tooltip and every accessible name', () => {
    expect(element('indicator-search').getAttribute('title')).toBe('Find (Ctrl+F)');
    expect(element('indicator-search').getAttribute('aria-label')).toBe('Find');
    expect(element('overflow-toggle').getAttribute('title')).toBe(
      'Hover any indicator for details',
    );
    expect(element('overflow-toggle').getAttribute('aria-label')).toBe('More indicators');
    expect(element('menu-toggle').getAttribute('aria-label')).toBe('Menu');
  });

  it('keeps every collapse class, so the bar still empties into the menu', () => {
    // The first build of this used `#id` selectors for the frame, which beat
    // the collapse rules on specificity: the buttons stopped collapsing, and
    // because the overflow menu offers what the breakpoint took out, three
    // entries vanished from it at 600px. Measured, then repaired by staying at
    // class specificity — these rows hold both halves of that.
    expect(element('indicator-search').className).toMatch(/indicator-collapse-800/);
    expect(element('badge-images').className).toMatch(/indicator-collapse-600/);
    expect(element('cluster-indicator').className).toMatch(/indicator-collapse-600/);
    const collapse = rules.filter((rule) => rule.selector.startsWith('.indicator-collapse-'));
    expect(collapse.length).toBe(3);
    for (const rule of collapse) {
      expect(rule.declarations.get('display')).toBe('none');
      // A frame written at id specificity would overrule this and the button
      // would never leave the bar; the family rule is a class for that reason.
      expect(rule.selector).not.toMatch(/#/);
    }
    const family = rules.filter((rule) => rule.selector.includes('.header-edge-button'));
    expect(family.length).toBeGreaterThan(0);
    for (const rule of family) expect(rule.selector).not.toMatch(/#/);
  });
});

describe('the overflow copy of a framed button is still readable', () => {
  it('copies the text, the tooltip and the state of a button that has text', () => {
    const cluster = element('cluster-indicator');
    cluster.removeAttribute('aria-hidden');
    cluster.textContent = '\u{1F4CE} 3 related';
    cluster.title = '3 related context files found in this tree';
    const clone = overflowClone(cluster);
    expect(clone.textContent).toBe('\u{1F4CE} 3 related');
    expect(clone.title).toBe('3 related context files found in this tree');
    expect(clone.getAttribute('aria-expanded')).toBe('false');
  });

  it('falls back to the accessible name for the button that holds only a drawing', () => {
    // The #312 defect shape: an icon-only button copied with its `textContent`
    // was a 94 by 4 px strip. The magnifier is the one member of the family
    // inside the offered group with no text of its own.
    const clone = overflowClone(element('indicator-search'));
    expect(clone.textContent).toBe('Find');
    expect(clone.textContent?.trim()).not.toBe('');
  });

  it('offers a button the breakpoint took out, and not one its module withdrew', () => {
    const images = element('badge-images');
    expect(images.getAttribute('aria-hidden')).toBe('true');
    expect(isOfferedInOverflow(images)).toBe(false);
  });
});
