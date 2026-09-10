/**
 * ── What can be asserted here, and what cannot ──
 *
 * `headingListPlacement` takes numbers and returns numbers, so the arithmetic
 * of where the list opens is checked directly, the way `toolbarTop` is since
 * #270. Everything else in this file is DOM structure and keyboard behaviour,
 * which happy-dom does answer.
 *
 * **What is not asserted anywhere is the placement itself.** That `position`
 * calls this function with the real toolbar rect, the real header bottom and
 * the real list height cannot be shown where every box measures 0 by 0. The
 * numbers below are arithmetic against arithmetic; the placement on screen is
 * verified by hand on Windows.
 *
 * **There is deliberately no test asserting the header is 44 px**, for the
 * reason #270 recorded: it is content-driven and it is 54 at 125 per cent
 * scaling and 64 at 150. The header bottom is varied across those measured
 * values instead.
 *
 * The numbers used as arguments are distinct from one another on purpose, so a
 * transposed pair changes a result rather than cancelling out.
 */
import { describe, expect, it } from 'vitest';
import {
  activeHeadingLevels,
  closeHeadingLevels,
  HEADING_CHOICES,
  HEADING_LEVEL_OPTION_CLASS,
  headingListPlacement,
  openHeadingLevels,
} from './heading-levels';

// The list and toolbar sizes measured on this branch in Chromium, used as
// realistic arguments rather than as claims about what either measures: the
// rendered list is 240 by 203 and the toolbar 31.59 tall.
const LIST_H = 203;
const TOOLBAR_H = 31.59;
const OFFSET = 4;
const MARGIN = 8;

describe('headingListPlacement — below the toolbar when it fits (#267)', () => {
  it('opens under the toolbar with the offset, in a roomy window', () => {
    const tbTop = 300;
    const tbBottom = tbTop + TOOLBAR_H;
    const p = headingListPlacement(tbTop, tbBottom, LIST_H, 44, 800);
    expect(p.above).toBe(false);
    expect(p.top).toBeCloseTo(tbBottom + OFFSET, 5);
    expect(p.maxHeight).toBe(LIST_H);
  });

  it('prefers below even when above would also fit', () => {
    // Both sides have room; the list reads downward, so downward wins.
    const tbTop = 400;
    const p = headingListPlacement(tbTop, tbTop + TOOLBAR_H, LIST_H, 44, 1000);
    expect(p.above).toBe(false);
  });
});

describe('headingListPlacement — above the toolbar when it does not (#267)', () => {
  it('flips above near the bottom of the window', () => {
    // The toolbar low in an 800 px window: nothing like 203 px fits under it.
    const tbTop = 700;
    const p = headingListPlacement(tbTop, tbTop + TOOLBAR_H, LIST_H, 44, 800);
    expect(p.above).toBe(true);
    expect(p.top).toBeCloseTo(tbTop - OFFSET - LIST_H, 5);
    expect(p.maxHeight).toBe(LIST_H);
  });

  it('never opens across the header, at any of the measured header heights', () => {
    // 44, 54, 64 and 87 are what the header computes to at 100, 125, 150 and
    // 200 per cent scaling. The ceiling follows the argument.
    for (const headerBottom of [44, 54, 64, 87]) {
      const tbTop = 700;
      const p = headingListPlacement(tbTop, tbTop + TOOLBAR_H, LIST_H, headerBottom, 800);
      expect(p.top).toBeGreaterThanOrEqual(headerBottom);
    }
  });
});

describe('headingListPlacement — capped when it fits neither way (#267)', () => {
  it('takes the roomier side and caps to it', () => {
    // The 600x400 case the sweep found: a toolbar in the middle of a short
    // window, with 203 px of list and room for neither side.
    const tbTop = 190;
    const tbBottom = tbTop + TOOLBAR_H;
    const p = headingListPlacement(tbTop, tbBottom, LIST_H, 44, 400);
    const roomBelow = 400 - MARGIN - (tbBottom + OFFSET);
    const roomAbove = tbTop - OFFSET - 44;

    expect(p.maxHeight).toBeLessThan(LIST_H);
    expect(p.maxHeight).toBeCloseTo(Math.max(roomBelow, roomAbove), 5);
    expect(p.above).toBe(roomAbove > roomBelow);
  });

  it('stays on screen on the capped branch, both ways', () => {
    // Swept through a short window: whichever side it lands on, the list ends
    // inside the window and starts at or below the header.
    const headerBottom = 54;
    for (let tbTop = headerBottom; tbTop <= 340; tbTop += 2) {
      const tbBottom = tbTop + TOOLBAR_H;
      const p = headingListPlacement(tbTop, tbBottom, LIST_H, headerBottom, 400);
      expect(p.top).toBeGreaterThanOrEqual(headerBottom);
      expect(p.top + p.maxHeight).toBeLessThanOrEqual(400 - MARGIN + 0.001);
    }
  });

  it('never returns a negative height', () => {
    // Arithmetic hygiene rather than a case anyone has produced: the smallest
    // room measured at the declared 600x400 minimum was 154.5 px.
    const p = headingListPlacement(50, 50 + TOOLBAR_H, LIST_H, 44, 60);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});

describe('the list the toolbar offers (#267)', () => {
  it('holds every level CommonMark spells, and the way back to body text', () => {
    expect(HEADING_CHOICES.map((c) => c.level)).toEqual([1, 2, 3, 4, 5, 6, null]);
  });

  it('reads as words rather than as tags', () => {
    // "Metadata, not Frontmatter" — the wording rule in CLAUDE.md.
    expect(HEADING_CHOICES.map((c) => c.label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Heading 5',
      'Heading 6',
      'Body text',
    ]);
  });
});

describe('the list, driven (#267)', () => {
  function anchorAndToolbar(): { anchor: HTMLElement; toolbar: HTMLElement } {
    const toolbar = document.createElement('div');
    const anchor = document.createElement('button');
    toolbar.appendChild(anchor);
    document.body.appendChild(toolbar);
    return { anchor, toolbar };
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.${HEADING_LEVEL_OPTION_CLASS}`),
    );
  }

  it('marks the level the caret is already in', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    openHeadingLevels({ anchor, toolbar, current: 4, onChoose: () => {} });

    const marked = rows().filter((r) => r.getAttribute('aria-current') === 'true');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe('Heading 4');
    closeHeadingLevels();
  });

  it('a second open leaves no first one behind', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: () => {} });
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: () => {} });
    expect(rows()).toHaveLength(HEADING_CHOICES.length);
    closeHeadingLevels();
  });

  it('the arrow keys move the highlight and Enter takes the one they are on', () => {
    // Opened at the top of the list, then walked down twice: the choice that
    // comes back is the third, which no initial state produces on its own.
    const { anchor, toolbar } = anchorAndToolbar();
    const chosen: string[] = [];
    openHeadingLevels({
      anchor,
      toolbar,
      current: 1,
      onChoose: (c) => chosen.push(c.label),
    });

    for (const key of ['ArrowDown', 'ArrowDown']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(chosen).toEqual(['Heading 3']);
    expect(activeHeadingLevels()).toBeNull();
  });

  it('Escape closes it and chooses nothing', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    const chosen: string[] = [];
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: (c) => chosen.push(c.label) });
    expect(activeHeadingLevels()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(activeHeadingLevels()).toBeNull();
    expect(rows()).toHaveLength(0);
    expect(chosen).toEqual([]);
  });

  it('a press outside closes it and chooses nothing', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    const chosen: string[] = [];
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: (c) => chosen.push(c.label) });

    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(activeHeadingLevels()).toBeNull();
    expect(chosen).toEqual([]);
  });
});
