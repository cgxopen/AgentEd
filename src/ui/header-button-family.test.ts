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
  'spellcheck-toggle',
  'indicator-search',
  'badge-images',
  'cluster-indicator',
  'overflow-toggle',
  'appearance-menu-trigger',
];

/** The members whose whole content is a drawing, and are therefore square. */
const SQUARE = ['menu-toggle', 'indicator-search', 'overflow-toggle', 'appearance-menu-trigger'];

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
    // `Spell: off` is not a thing that can exist, so width and the side padding
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
    // Spell is measured rather than assumed: it carries no state attribute at
    // all, and its text is what states the state. That is why it keeps its text
    // while the drawing-only members do not have one to keep.
    expect(element('spellcheck-toggle').getAttribute('aria-pressed')).toBeNull();
    expect(element('spellcheck-toggle').getAttribute('aria-expanded')).toBeNull();
    expect(element('spellcheck-toggle').textContent?.trim()).toBe('Spell: off');
    for (const id of ['indicator-search', 'badge-images', 'cluster-indicator', 'overflow-toggle']) {
      expect(element(id).getAttribute('aria-expanded'), id).toBe('false');
    }
  });

  it('keeps every tooltip and every accessible name', () => {
    expect(element('spellcheck-toggle').getAttribute('title')).toBe(
      'Click to enable spell-check for this session',
    );
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
