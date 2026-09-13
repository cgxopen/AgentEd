/**
 * `popoverPlacement` takes numbers and returns numbers, so where a popover
 * opens is checked here directly, the way `toolbarTop` is since #270.
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
import { POPOVER_MARGIN, POPOVER_OFFSET, popoverPlacement } from './popover-placement';

// The heading list and the floating toolbar it hangs from, measured in #267 in
// Chromium: realistic arguments rather than claims about what either measures.
const LIST_H = 203;
const ANCHOR_H = 31.59;

describe('popoverPlacement — below the anchor when it fits', () => {
  it('opens under the anchor with the offset, in a roomy window', () => {
    const anchorTop = 300;
    const anchorBottom = anchorTop + ANCHOR_H;
    const p = popoverPlacement(anchorTop, anchorBottom, LIST_H, 44, 800);
    expect(p.above).toBe(false);
    expect(p.top).toBeCloseTo(anchorBottom + POPOVER_OFFSET, 5);
    expect(p.maxHeight).toBe(LIST_H);
  });

  it('prefers below even when above would also fit', () => {
    // Both sides have room; a popover reads downward, so downward wins.
    const anchorTop = 400;
    const p = popoverPlacement(anchorTop, anchorTop + ANCHOR_H, LIST_H, 44, 1000);
    expect(p.above).toBe(false);
  });
});

describe('popoverPlacement — above the anchor when it does not', () => {
  it('flips above near the bottom of the window', () => {
    // The anchor low in an 800 px window: nothing like 203 px fits under it.
    const anchorTop = 700;
    const p = popoverPlacement(anchorTop, anchorTop + ANCHOR_H, LIST_H, 44, 800);
    expect(p.above).toBe(true);
    expect(p.top).toBeCloseTo(anchorTop - POPOVER_OFFSET - LIST_H, 5);
    expect(p.maxHeight).toBe(LIST_H);
  });

  it('never opens across the header, at any of the measured header heights', () => {
    // 44, 54, 64 and 87 are what the header computes to at 100, 125, 150 and
    // 200 per cent scaling. The ceiling follows the argument.
    for (const headerBottom of [44, 54, 64, 87]) {
      const anchorTop = 700;
      const p = popoverPlacement(anchorTop, anchorTop + ANCHOR_H, LIST_H, headerBottom, 800);
      expect(p.top).toBeGreaterThanOrEqual(headerBottom);
    }
  });
});

describe('popoverPlacement — capped when it fits neither way', () => {
  it('takes the roomier side and caps to it', () => {
    // The 600x400 case the #267 sweep found: an anchor in the middle of a short
    // window, with 203 px of list and room for neither side.
    const anchorTop = 190;
    const anchorBottom = anchorTop + ANCHOR_H;
    const p = popoverPlacement(anchorTop, anchorBottom, LIST_H, 44, 400);
    const roomBelow = 400 - POPOVER_MARGIN - (anchorBottom + POPOVER_OFFSET);
    const roomAbove = anchorTop - POPOVER_OFFSET - 44;

    expect(p.maxHeight).toBeLessThan(LIST_H);
    expect(p.maxHeight).toBeCloseTo(Math.max(roomBelow, roomAbove), 5);
    expect(p.above).toBe(roomAbove > roomBelow);
  });

  it('stays on screen on the capped branch, both ways', () => {
    // Swept through a short window: whichever side it lands on, the popover
    // ends inside the window and starts at or below the header.
    const headerBottom = 54;
    for (let anchorTop = headerBottom; anchorTop <= 340; anchorTop += 2) {
      const anchorBottom = anchorTop + ANCHOR_H;
      const p = popoverPlacement(anchorTop, anchorBottom, LIST_H, headerBottom, 400);
      expect(p.top).toBeGreaterThanOrEqual(headerBottom);
      expect(p.top + p.maxHeight).toBeLessThanOrEqual(400 - POPOVER_MARGIN + 0.001);
    }
  });

  it('never returns a negative height', () => {
    // Arithmetic hygiene rather than a case anyone has produced: the smallest
    // room measured at the declared 600x400 minimum was 154.5 px.
    const p = popoverPlacement(50, 50 + ANCHOR_H, LIST_H, 44, 60);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
