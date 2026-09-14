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
    // A window 60 px tall, far below the declared 600x400 minimum.
    const p = popoverPlacement(50, 50 + ANCHOR_H, LIST_H, 44, 60);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The band between the header and the window edge (#296)
// ─────────────────────────────────────────────────────────────────────────────

// The emoji palette, measured on the #296 step zero: 200 emoji in rows of 8.
const GRID_H = 964;

/** Whether a placement starts at or below the header and ends inside the window. */
function inBand(p: { top: number; maxHeight: number }, headerBottom: number, vh: number): boolean {
  return p.top >= headerBottom - 0.001 && p.top + p.maxHeight <= vh - POPOVER_MARGIN + 0.001;
}

describe('popoverPlacement — an anchor outside the window still gives a popover inside it', () => {
  it('keeps the popover in the band for an anchor scrolled above the window', () => {
    // Measured on the step zero before this existed: a caret scrolled out above
    // put the palette at top -2380 in a 400 px window.
    for (const height of [LIST_H, GRID_H]) {
      const p = popoverPlacement(-2400, -2380, height, 44, 400);
      expect(inBand(p, 44, 400), `height ${height}`).toBe(true);
      expect(p.maxHeight).toBeGreaterThan(0);
    }
  });

  it('keeps the popover in the band for an anchor scrolled below the window', () => {
    // And at top +1908 for a caret scrolled out below.
    for (const height of [LIST_H, GRID_H]) {
      const p = popoverPlacement(1930, 1950, height, 64, 400);
      expect(inBand(p, 64, 400), `height ${height}`).toBe(true);
      expect(p.maxHeight).toBeGreaterThan(0);
    }
  });

  it('covers the anchor from the header down when neither side has any room', () => {
    // The recorded fact: an anchor as tall as the window left no room either
    // side, and the popover came back with a max height of 0.
    for (const headerBottom of [44, 54, 64, 87]) {
      const p = popoverPlacement(headerBottom, 400, GRID_H, headerBottom, 400);
      expect(p.top).toBe(headerBottom);
      expect(p.maxHeight).toBe(400 - POPOVER_MARGIN - headerBottom);
    }
    const short = popoverPlacement(44, 400, LIST_H, 44, 400);
    expect(short.maxHeight).toBe(LIST_H);
  });

  it('stays in the band for every anchor position, on screen or not', () => {
    for (const height of [LIST_H, GRID_H]) {
      for (let anchorTop = -600; anchorTop <= 1000; anchorTop += 7) {
        const p = popoverPlacement(anchorTop, anchorTop + ANCHOR_H, height, 54, 400);
        expect(inBand(p, 54, 400), `top ${anchorTop}, height ${height}`).toBe(true);
      }
    }
  });
});
