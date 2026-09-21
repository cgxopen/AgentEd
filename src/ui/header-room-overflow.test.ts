import { beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { isOfferedInOverflow } from '../app/header-wiring';
import wiringSource from '../app/header-wiring.ts?raw';
import stylesCss from '../styles.css?raw';
import { stylesheetRules } from '../test-support/stylesheet-rules';
import { NO_ROOM_CLASS } from './header-room';
import roomSource from './header-room.ts?raw';

/**
 * Issue #413 — a count the room rule takes out of the bar is still offered in
 * the kebab list.
 *
 * **Said first: whether the class lands on the right count at the right width
 * is layout, and no row here sees it.** happy-dom performs no layout, so
 * `offsetParent` is `undefined` for everything. That half is the manual pass.
 *
 * What these rows join is three facts, each **read** rather than restated: what
 * the class does, out of the shipped stylesheet; which elements the menu builds
 * itself from, out of `header-wiring.ts` and run against the shipped markup;
 * and what the predicate answers for a count in that state. Either half alone
 * asserts nothing — a class that hid the count the other way would pass the
 * first and fail the third, which is why the third has its own reversal row.
 */

const rules = stylesheetRules(stylesCss);

function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

/** The selector the overflow menu is built from, read out of its own source. */
function overflowSelector(): string {
  const found = wiringSource.match(/querySelectorAll<HTMLElement>\(\s*'([^']+)'\s*\)/);
  if (!found) throw new Error('the overflow menu no longer builds itself from one selector');
  return found[1];
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped header has no #${id}`);
  return found;
}

/** What a browser would answer once `display: none` has taken the count out. */
function takenOutOfTheBar(el: HTMLElement): HTMLElement {
  Object.defineProperty(el, 'offsetParent', { value: null, configurable: true });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = shippedHeaderMarkup();
});

describe('the room rule hides in the way the overflow menu understands (#413)', () => {
  it('the class takes the count out of the bar and says nothing about aria', () => {
    const rule = rules.filter((r) => r.selector === `.${NO_ROOM_CLASS}`);
    expect(rule.length).toBe(1);
    expect(rule[0].declarations.get('display')).toBe('none');
    // The one thing it must not do: `aria-hidden` reads as withdrawn, and a
    // withdrawn indicator is offered nowhere.
    expect(rule[0].declarations.has('aria-hidden')).toBe(false);
    // And it sits in no media query, because the width is no longer the
    // trigger — the whole of the change.
    expect(rule[0].conditions).toEqual([]);
  });

  it('both counts are reached by the selector the menu builds itself from', () => {
    const reached = Array.from(document.querySelectorAll(overflowSelector()));
    for (const id of ['word-count', 'char-count']) {
      expect(reached.includes(element(id)), `${id} reached by ${overflowSelector()}`).toBe(true);
    }
  });

  it('a count carrying the class is offered, exactly as a collapsed one is', () => {
    const count = element('char-count');
    count.classList.add(NO_ROOM_CLASS);
    expect(count.getAttribute('aria-hidden')).toBeNull();
    expect(isOfferedInOverflow(takenOutOfTheBar(count))).toBe(true);
  });

  it('and would not be offered if the rule had withdrawn it instead', () => {
    // The half that gives the row above its meaning: it has to fail when the
    // hide is the other kind.
    const count = element('char-count');
    count.classList.add(NO_ROOM_CLASS);
    count.setAttribute('aria-hidden', 'true');
    expect(isOfferedInOverflow(takenOutOfTheBar(count))).toBe(false);
  });

  it('the observer hides with the class and never with aria, read from its source', () => {
    // The observer cannot be driven here - it measures, and there is no layout
    // to measure - so what it *does* is read out of it instead. This is the
    // row that fails if the hide is ever changed to the withdrawn kind.
    expect(roomSource).toMatch(/characters\??\.classList\.toggle\(NO_ROOM_CLASS/);
    expect(roomSource).toMatch(/words\??\.classList\.toggle\(NO_ROOM_CLASS/);
    // Narrowed to the counts on purpose: the measuring span sets `aria-hidden`
    // on itself, and should - it is decorative and must reach no reader.
    expect(roomSource).not.toMatch(/\b(words|characters)\??\.setAttribute/);
  });

  it('the counts ship carrying no width breakpoint of their own', () => {
    for (const id of ['word-count', 'char-count']) {
      expect(element(id).className, id).not.toMatch(/indicator-collapse-/);
    }
  });
});

describe('what keeps its fixed width, and is not on the rule (#413, owner decision 1)', () => {
  it('the search button, the tokens unit and the two badges keep their breakpoints', () => {
    expect(element('indicator-search').className).toMatch(/indicator-collapse-800/);
    expect(element('token-unit').className).toMatch(/indicator-collapse-600/);
    expect(element('badge-metadata').className).toMatch(/indicator-collapse-600/);
    expect(element('badge-images').className).toMatch(/indicator-collapse-600/);
  });

  it('and none of them carries the room class the counts are hidden by', () => {
    for (const id of ['indicator-search', 'token-unit', 'badge-metadata', 'badge-images']) {
      expect(element(id).className, id).not.toMatch(NO_ROOM_CLASS);
    }
  });

  it('the breakpoint rules they stand on are still in the sheet, at class specificity', () => {
    // Read from the stylesheet rather than restated: a frame written at id
    // specificity would overrule these and the controls would never collapse,
    // which is the #332 defect these rows also stand against.
    const collapse = rules.filter((r) => r.selector.startsWith('.indicator-collapse-'));
    expect(collapse.length).toBe(3);
    for (const rule of collapse) {
      expect(rule.declarations.get('display')).toBe('none');
      expect(rule.selector).not.toMatch(/#/);
      expect(rule.conditions.length).toBe(1);
      expect(rule.conditions[0]).toMatch(/max-width/);
    }
  });

  it('the #366 rule that moves the badges below 901 px is untouched', () => {
    const badgeRule = rules.filter((r) => r.selector.includes('#badge-metadata'));
    expect(badgeRule.length).toBe(1);
    expect(badgeRule[0].conditions[0]).toMatch(/max-width:\s*900px/);
  });
});
