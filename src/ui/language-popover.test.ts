import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeLanguagePopover,
  LANGUAGE_ERROR_CLASS,
  LANGUAGE_POPOVER_CLASS,
  languagePopoverOffset,
  openLanguagePopover,
} from './language-popover';
import { POPOVER_OFFSET } from './popover-placement';

/**
 * Where the language popover opens against its block label (#272).
 *
 * happy-dom reports every rectangle as zero, so where it lands on a screen is
 * verified by hand. Two things are asserted here instead:
 *
 * - **the arithmetic**, `languagePopoverOffset`, which takes numbers and
 *   returns an edge and a pixel offset;
 * - **the wiring**, by opening the real popover with rectangles supplied to
 *   it: the anchor, the header, and a popover whose height depends on whether
 *   its refusal line is showing, the way it does in a browser. Without that
 *   half a `position` that ignored the taller state, or never called the
 *   arithmetic, would pass everything above it.
 *
 * The heights are the ones measured in Chromium on `d69d893`: 45 px closed and
 * 84.6 px with a refusal shown.
 */

const CLOSED_H = 45;
const REFUSED_H = 84.6;
const LABEL_H = 18;

describe('languagePopoverOffset — the side is chosen for the taller state', () => {
  it('opens below, by its top, where the taller popover fits', () => {
    const offset = languagePopoverOffset(200, 200 + LABEL_H, REFUSED_H, 44, 400);
    expect(offset).toEqual({ edge: 'top', px: 200 + LABEL_H + POPOVER_OFFSET });
  });

  it('opens above, by its bottom, where only the closed popover would have fitted below', () => {
    // Room below is 400 - 8 - (318 + 4) = 70: enough for 45, not for 84.6.
    // Chosen for 45 this opened below and ran past the edge once a refusal
    // appeared, which is the state step zero measured.
    const labelTop = 300;
    const offset = languagePopoverOffset(labelTop, labelTop + LABEL_H, REFUSED_H, 44, 400);
    expect(offset).toEqual({ edge: 'bottom', px: 400 - (labelTop - POPOVER_OFFSET) });
  });

  it('holds an upward popover just over its label, whatever its height becomes', () => {
    // Held by the bottom edge, so the refusal grows it away from the label:
    // the edge it is held by does not depend on the height at all.
    const labelTop = 350;
    const tall = languagePopoverOffset(labelTop, labelTop + LABEL_H, REFUSED_H, 64, 400);
    const taller = languagePopoverOffset(labelTop, labelTop + LABEL_H, 120, 64, 400);
    expect(tall).toEqual(taller);
  });

  it('stays inside the window in both states, over a sweep of label positions and headers', () => {
    // Every label position of a 600x400 window, at the header heights measured
    // for 100, 125, 150 and 200 per cent scaling.
    for (const headerBottom of [44, 54, 64, 87]) {
      for (let labelTop = headerBottom; labelTop + LABEL_H <= 400; labelTop += 1) {
        const offset = languagePopoverOffset(
          labelTop,
          labelTop + LABEL_H,
          REFUSED_H,
          headerBottom,
          400,
        );
        for (const height of [CLOSED_H, REFUSED_H]) {
          const top = offset.edge === 'top' ? offset.px : 400 - offset.px - height;
          expect(top).toBeGreaterThanOrEqual(headerBottom);
          expect(top + height).toBeLessThanOrEqual(400);
        }
      }
    }
  });
});

/** A rectangle with only the fields the placement reads filled in. */
function rect(top: number, height: number, left = 20, width = 260): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('the popover is placed through that arithmetic', () => {
  let label: HTMLElement;
  let labelTop = 0;
  const innerHeight = window.innerHeight;

  beforeEach(() => {
    document.body.innerHTML = '<header id="menubar"></header>';
    label = document.createElement('button');
    document.body.appendChild(label);
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === label) return rect(labelTop, LABEL_H);
      if (this.id === 'menubar') return rect(0, 44);
      if (this.classList.contains(LANGUAGE_POPOVER_CLASS)) {
        const line = this.querySelector<HTMLElement>(`.${LANGUAGE_ERROR_CLASS}`);
        return rect(0, line !== null && !line.hidden ? REFUSED_H : CLOSED_H);
      }
      return rect(0, 0);
    });
  });

  afterEach(() => {
    closeLanguagePopover();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    document.body.innerHTML = '';
  });

  function openAt(top: number): HTMLElement {
    labelTop = top;
    return openLanguagePopover({
      anchor: label,
      initial: '',
      onCommit: () => undefined,
      onCancel: () => undefined,
    }).element;
  }

  it('opens under a label with room, where it opened before #272', () => {
    const popover = openAt(200);
    expect(popover.style.top).toBe(`${200 + LABEL_H + POPOVER_OFFSET}px`);
    expect(popover.style.bottom).toBe('');
  });

  it('opens over a label with room for the closed popover only, held by its bottom', () => {
    const popover = openAt(300);
    expect(popover.style.bottom).toBe(`${400 - (300 - POPOVER_OFFSET)}px`);
    expect(popover.style.top).toBe('');
  });

  it('leaves nothing behind from measuring the taller state', () => {
    const popover = openAt(300);
    const line = popover.querySelector<HTMLElement>(`.${LANGUAGE_ERROR_CLASS}`);
    expect(line?.hidden).toBe(true);
    expect(line?.textContent).toBe('');
    expect(document.querySelectorAll(`.${LANGUAGE_POPOVER_CLASS}`)).toHaveLength(1);
  });
});
