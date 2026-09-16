/**
 * Issue #330 — the Appearance trigger's icon and its seat in the header.
 *
 * **Said at the head: the seat is layout and no row below sees it.** happy-dom
 * performs no layout and reports every rectangle as zero, so where the button
 * sits, where the popover opens against it and whether the symbol is legible
 * are verified in the manual pass on the pull request artifact, not here. The
 * figures that decided the change were measured in Chromium against the built
 * page and are written on the issue.
 *
 * What these rows do assert is the half of the change the harness can reach:
 *
 * - the shipped markup holds the inline SVG, hidden from the accessibility
 *   tree, drawn in `currentColor`, and the button keeps the name, the tooltip
 *   and the `aria-expanded` / `aria-controls` pair it had with the ellipsis;
 * - the stylesheet rules that reach the rendered elements — read out of the
 *   sheet and run against what `innerHTML` produced, both halves joined,
 *   because either alone asserts nothing: a rule nobody reaches and an element
 *   nobody styles both pass a test that checks only one side;
 * - the arithmetic that puts the popover's right edge on the button's, which is
 *   numbers in and numbers out and therefore is observable;
 * - that the popover still opens and closes by every route it had.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { ThemeManager } from '../app/theme-manager';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { popoverRight, setupAppearanceMenu } from './appearance-menu';

const rules = stylesheetRules(stylesCss);

/**
 * The page's `<header>`. Only that fragment: mounting the whole document would
 * send happy-dom fetching the stylesheet and the icons — the reason `menu.test`
 * slices the same way.
 */
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

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = shippedHeaderMarkup();
});

describe('the trigger carries the half-filled circle as an inline SVG', () => {
  it('holds exactly one SVG and no text of its own', () => {
    const trigger = element('appearance-menu-trigger');
    expect(trigger.querySelectorAll('svg')).toHaveLength(1);
    expect(trigger.textContent?.trim()).toBe('');
  });

  it('hides the SVG from the accessibility tree', () => {
    const svg = element('appearance-menu-trigger').querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the outline and the filled half in currentColor, so the palette owns both', () => {
    const svg = element('appearance-menu-trigger').querySelector('svg') as SVGElement;
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    const half = svg.querySelector('path') as SVGElement;
    expect(half.getAttribute('fill')).toBe('currentColor');
    // The outline is a stroke and the half is a fill; neither may be the other.
    expect(svg.getAttribute('fill')).toBe('none');
    expect(half.getAttribute('stroke')).toBe('none');
  });

  it('adds no image file and no dependency: the symbol is in the page', () => {
    const svg = element('appearance-menu-trigger').querySelector('svg') as SVGElement;
    expect(svg.querySelector('image')).toBeNull();
    expect(svg.outerHTML).not.toMatch(/url\(|href=/);
  });
});

describe('the button keeps everything about it that is not the icon', () => {
  it('keeps its tooltip and its accessible name', () => {
    const trigger = element('appearance-menu-trigger');
    expect(trigger.getAttribute('title')).toBe('Appearance');
    expect(trigger.getAttribute('aria-label')).toBe('Appearance settings');
  });

  it('keeps the aria pair, naming the surface it reveals', () => {
    const trigger = element('appearance-menu-trigger');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('appearance-popover');
    expect(document.getElementById('appearance-popover')).not.toBeNull();
  });

  it('is the last control in the right-hand group, which is what far right means', () => {
    const group = document.querySelector('.header-right') as HTMLElement;
    expect(group.lastElementChild?.id).toBe('appearance-menu-trigger');
  });
});

describe('the stylesheet reaches what the page rendered', () => {
  it('sizes the icon and the button against the hamburger at the other end', () => {
    // The owner asked for one size across the two ends of the header. Nothing
    // in the sheet can tie them: the hamburger's box comes from text metrics
    // and this one from an icon size, so the numbers are matched by hand and
    // the row records which they are. 15px of icon is 13px of drawn circle
    // against the hamburger's 13.25px of drawn bars, and 7 by 11 of padding
    // with a 1px border is 39 by 31 against its 38.1 by 31.
    const trigger = element('appearance-menu-trigger');
    const svg = trigger.querySelector('svg') as SVGElement;
    expect(valuesReaching(rules, svg, 'width')).toEqual(['15px']);
    expect(valuesReaching(rules, svg, 'height')).toEqual(['15px']);
    // The `*` reset declares `padding: 0` first and this rule is the last to
    // reach the button, so the last value is the one that stands.
    expect(valuesReaching(rules, trigger, 'padding').at(-1)).toBe('7px 11px');

    // The frame is the hamburger's own token, so the two follow the palette
    // together. A value of `none` here is the button unframed again.
    const hamburger = element('menu-toggle');
    expect(valuesReaching(rules, trigger, 'border')).toEqual(['1px solid var(--border)']);
    expect(valuesReaching(rules, trigger, 'border')).toEqual(
      valuesReaching(rules, hamburger, 'border'),
    );
    expect(valuesReaching(rules, trigger, 'border-radius')).toEqual(
      valuesReaching(rules, hamburger, 'border-radius'),
    );
  });

  it('collapses the trigger line box, since what is inside it is no longer text', () => {
    const trigger = element('appearance-menu-trigger');
    expect(valuesReaching(rules, trigger, 'line-height')).toEqual(['0']);
    expect(valuesReaching(rules, trigger, 'font-size')).toEqual([]);
  });

  it('reserves nothing on the right of the header, at any window width (#330)', () => {
    // The window controls are on the native title bar above this webview, not
    // inside it. A rule at any width putting room back here is the defect the
    // issue removed: it is what held the button 144px from the edge.
    const group = document.querySelector('.header-right') as HTMLElement;
    expect(valuesReaching(rules, group, 'margin-right')).toEqual([]);
    // The `*` reset is the only `margin` that reaches it, and it reserves
    // nothing; a shorthand with room in it would have to be read here too.
    expect(valuesReaching(rules, group, 'margin')).toEqual(['0']);
  });

  it('gives the popover no width constant that outruns its anchor', () => {
    const popover = element('appearance-popover');
    // One resting `right`, which `setupAppearanceMenu` overwrites from the
    // button's rectangle; a second, in a media query, would win at that width
    // and unpin the popover from the button — the shape the issue removed.
    expect(valuesReaching(rules, popover, 'right')).toHaveLength(1);
    expect(valuesReaching(rules, popover, 'left')).toEqual([]);
  });
});

describe('the overflow menu and the trigger (the #312 lesson, and why it does not reach here)', () => {
  it('leaves the trigger out of the group the overflow menu copies', () => {
    // `renderOverflowPopover` offers `#header-indicators .indicator` and the
    // trigger is outside that group, so an icon-only button cannot become the
    // unreadable 94 by 4 px strip #312 found. It never collapses either: it
    // carries no `indicator-collapse-*` class.
    const offered = Array.from(document.querySelectorAll('#header-indicators .indicator'));
    const trigger = element('appearance-menu-trigger');
    expect(offered).not.toContain(trigger);
    expect(trigger.className).not.toMatch(/indicator-collapse-/);
  });
});

describe('the popover opens against the button', () => {
  it('puts the popover right edge on the trigger right edge', () => {
    // Arithmetic, not layout: `right` inside the menubar is the distance from
    // the menubar's right edge, and the trigger's own distance from it is that.
    expect(popoverRight(1200, 1184)).toBe(16);
    expect(popoverRight(600, 584)).toBe(16);
    // A trigger that moves takes the popover with it; nothing here is constant.
    expect(popoverRight(1200, 1056)).toBe(144);
  });

  it('writes that number onto the popover when it opens', () => {
    // happy-dom reports every rectangle as zero, so the value it computes here
    // is 0px; what this row establishes is that the open path sets `right` from
    // the rectangles at all, rather than leaving the stylesheet's constant.
    const trigger = element('appearance-menu-trigger');
    const popover = element('appearance-popover');
    setupAppearanceMenu(new ThemeManager());
    expect(popover.style.right).toBe('');
    trigger.click();
    expect(popover.style.right).toMatch(/^-?\d+(\.\d+)?px$/);
  });

  it('still opens and closes by every route it had', () => {
    const trigger = element('appearance-menu-trigger');
    const popover = element('appearance-popover');
    setupAppearanceMenu(new ThemeManager());
    const hidden = () => popover.classList.contains('hidden');

    expect(hidden()).toBe(true);
    trigger.click();
    expect(hidden()).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    trigger.click();
    expect(hidden()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hidden()).toBe(true);

    trigger.click();
    document.body.click();
    expect(hidden()).toBe(true);

    trigger.click();
    popover.click();
    expect(hidden()).toBe(false);
  });
});
