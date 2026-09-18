/**
 * #366 - the header becomes the title bar on Windows: what is drawn into it.
 *
 * **Said first: layout, colour and the window are not observable here.**
 * Whether the bar reads as one, whether it drags and maximizes, and how it
 * sits at 100, 125 and 150 per cent is the owner pass on Windows. These rows
 * hold the markup `drawWindowFrame` adds to the shipped header, the drag
 * region on every passive part and on no control, and the stylesheet rules for
 * the narrow band, read out of the sheet and run against the drawn elements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import type { WindowControls } from '../platform';
import stylesCss from '../styles.css?raw';
import { reaches, stylesheetRules } from '../test-support/stylesheet-rules';
import { DRAG_REGION, drawWindowFrame } from './window-frame';

const rules = stylesheetRules(stylesCss);

function mountHeader(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  document.body.innerHTML = shippedPage.slice(open, close + '</header>'.length);
}

function controls(): WindowControls & Record<string, ReturnType<typeof vi.fn>> {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

/** Whether a rule inside `@media (max-width: N)` hides `target` with `display: none`. */
function hiddenBelow(target: Element, width: number): boolean {
  return rules.some(
    (rule) =>
      rule.conditions.some((c) => c.includes(`max-width: ${width}px`)) &&
      reaches(rule.selector, target) &&
      rule.declarations.get('display') === 'none',
  );
}

beforeEach(mountHeader);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('the frame drawn into the header (#366)', () => {
  it('puts the brand first at the left: the mark in the palette text colour, and the name', () => {
    drawWindowFrame(controls());
    const brand = element('#menubar .header-left > .window-brand:first-child');

    const mark = brand.querySelector('.window-brand-mark svg');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    // V2: the `.md_` takes the palette text colour, and no white is left in it.
    expect(mark?.querySelectorAll('[fill="currentColor"]').length).toBeGreaterThan(0);
    expect(mark?.querySelectorAll('[fill="#FFFFFF"]')).toHaveLength(0);
    expect(brand.querySelector('.window-brand-name')?.textContent).toBe('AgentEd');
  });

  it('puts minimize, maximize and close after the right-hand group, out of the Tab order', () => {
    drawWindowFrame(controls());
    const caption = element('#menubar > .window-caption');
    const buttons = [...caption.querySelectorAll('button')];

    expect(caption.previousElementSibling).toBe(element('#menubar .header-right'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Minimize',
      'Maximize',
      'Close',
    ]);
    for (const button of buttons) expect(button.tabIndex, button.title).toBe(-1);
  });

  it('runs each control from its own button and no other', () => {
    const handed = controls();
    drawWindowFrame(handed);
    const calls = {
      Minimize: 'minimize',
      Maximize: 'toggleMaximize',
      Close: 'close',
    } as const;

    for (const [label, call] of Object.entries(calls)) {
      element(`.window-caption button[aria-label="${label}"]`).click();
      for (const name of Object.values(calls)) {
        expect(handed[name], `${label} -> ${name}`).toHaveBeenCalledTimes(name === call ? 1 : 0);
      }
      vi.clearAllMocks();
    }
  });

  it('adds nothing when it is not called, which is the web build and the Linux lane', () => {
    expect(document.querySelector('.window-brand')).toBeNull();
    expect(document.querySelector('.window-caption')).toBeNull();
    expect(document.querySelector(`[${DRAG_REGION}]`)).toBeNull();
  });
});

describe('the drag region is on every passive part of the bar and on no control (#366)', () => {
  it('marks the bar, its groups, the brand, the document name and the readouts', () => {
    drawWindowFrame(controls());
    for (const selector of [
      '#menubar',
      '#menubar .header-left',
      '#menubar .header-right',
      '.window-brand',
      '.window-brand-mark',
      '.window-brand-name',
      '#filename',
      '#header-indicators',
      '#count-readout',
      '#token-number',
      '#badge-metadata',
    ]) {
      expect(element(selector).hasAttribute(DRAG_REGION), selector).toBe(true);
    }
  });

  it('puts it on nothing that takes a press, and on nothing inside the menu', () => {
    // Tauri starts a drag from the element under the pointer when it carries
    // the attribute, so a control carrying it would move the window instead.
    drawWindowFrame(controls());
    const marked = [...document.querySelectorAll(`[${DRAG_REGION}]`)];
    const controlsMarked = marked.filter(
      (el) =>
        el.matches('button, a, input, select, textarea, [role="button"], [tabindex]') ||
        el.closest('#menu-dropdown') !== null,
    );

    expect(marked.length).toBeGreaterThan(10);
    expect(controlsMarked.map((el) => el.id || el.className)).toEqual([]);
  });
});

describe('the narrow band keeps the document name (#366)', () => {
  it('hides the brand name below 701 px, leaving the mark', () => {
    drawWindowFrame(controls());
    expect(hiddenBelow(element('.window-brand-name'), 700)).toBe(true);
    expect(hiddenBelow(element('.window-brand-mark'), 700)).toBe(false);
  });

  it('moves the three badges into the list below 901 px on the fused bar only', () => {
    const badges = ['#badge-metadata', '#badge-images', '#cluster-indicator'];
    for (const badge of badges) expect(hiddenBelow(element(badge), 900), badge).toBe(false);

    drawWindowFrame(controls());
    for (const badge of badges) expect(hiddenBelow(element(badge), 900), badge).toBe(true);
  });
});

describe('the caption buttons take the one hover of the bar (#368)', () => {
  /** The value each rule naming `state` gives `property` on `target`, with `state` taken out. */
  function inState(target: Element, state: string, property: string): string[] {
    return rules
      .filter((rule) => rule.conditions.length === 0 && rule.selector.includes(state))
      .filter((rule) => reaches(rule.selector.replaceAll(state, ''), target))
      .filter((rule) => rule.declarations.has(property))
      .map((rule) => rule.declarations.get(property) as string);
  }

  it('shades minimize and maximize with the hover overlay, under the pointer and pressed', () => {
    // Owner decision of 2026-09-18: one hover token for the whole bar. The
    // caption buttons took the strong overlay until then, beside header buttons
    // that took this one.
    drawWindowFrame(controls());
    for (const selector of ['.window-caption-minimize', '.window-caption-maximize']) {
      for (const state of [':hover', ':active']) {
        expect(
          inState(element(selector), state, 'background-color'),
          `${selector} ${state}`,
        ).toEqual(['var(--hover-overlay)']);
      }
    }
  });

  it('keeps close red under the pointer, later in the sheet than the shared shade', () => {
    drawWindowFrame(controls());
    const close = element('.window-caption-close');
    expect(inState(close, ':hover', 'background-color')).toEqual([
      'var(--hover-overlay)',
      '#c42b1c',
    ]);
  });
});
