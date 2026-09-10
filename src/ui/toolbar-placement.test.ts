/**
 * ── What these assertions are worth, and where they stop ──
 *
 * This is the first test in the toolbar family that asserts a **position**
 * rather than an ordering, and the reason it can is that `toolbarTop` takes
 * numbers instead of reading the DOM. Everything below is arithmetic checked
 * against arithmetic.
 *
 * **It is not evidence that the toolbar is placed correctly.** That
 * `positionToolbar` calls this with the *real* header bottom, the real toolbar
 * height and the real selection coordinates cannot be asserted anywhere in this
 * suite: happy-dom performs no layout, so `getBoundingClientRect` answers 0 for
 * every box and `coordsAtPos` answers nothing useful. The wiring is verified by
 * hand on Windows — the states at 125 per cent scaling and in the smallest
 * window at 150 per cent are precisely the ones that exercise it, because the
 * header is 54 and 64 px there rather than 44.
 *
 * **There is deliberately no test here asserting the header is 44 px.** It is
 * content-driven and it is 54 at 125 per cent scaling and 64 at 150. Pinning
 * that number is the mistake this issue exists because of, so the header bottom
 * is varied across the four measured values instead.
 *
 * The values below are all distinct from one another on purpose: two arguments
 * of the same type swapped by accident would change a result rather than
 * cancelling out.
 */
import { describe, expect, it } from 'vitest';
import { toolbarTop } from './toolbar-placement';

// The measured toolbar height on the shipped build, used as a realistic
// argument rather than as a claim about what the toolbar measures.
const TOOLBAR_H = 31.59;
const GAP = 8;

describe('toolbarTop — above the selection when there is room (#268)', () => {
  it('sits its own height plus the gap above the selection', () => {
    // Room to spare: a selection in the middle of the document.
    expect(toolbarTop(400, 427.19, TOOLBAR_H, 44)).toBeCloseTo(400 - TOOLBAR_H - GAP, 5);
  });

  it('is unaffected by the selection bottom while it fits above', () => {
    // The ordinary case must not move when the flip is added — the bottom is
    // read only on the other branch.
    const a = toolbarTop(400, 427.19, TOOLBAR_H, 44);
    const b = toolbarTop(400, 900, TOOLBAR_H, 44);
    expect(a).toBe(b);
  });

  it('takes the header bottom as its floor, not the window top', () => {
    // The defect: `Math.max(8, top)` knew only the window top, so a correctly
    // measured toolbar was placed inside the header. Here the result is never
    // above the header bottom while the above branch is taken.
    for (const headerBottom of [44, 54, 64, 87]) {
      const selectionTop = headerBottom + TOOLBAR_H + GAP + 100;
      expect(
        toolbarTop(selectionTop, selectionTop + 27, TOOLBAR_H, headerBottom),
      ).toBeGreaterThanOrEqual(headerBottom);
    }
  });
});

describe('toolbarTop — below the selection when there is not (#268)', () => {
  it('flips to the gap under the selection inside the band', () => {
    // A selection close under the header: 10 px of room where 39.59 is needed.
    const headerBottom = 44;
    const selectionTop = headerBottom + 10;
    const selectionBottom = selectionTop + 27.19;
    expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom)).toBeCloseTo(
      selectionBottom + GAP,
      5,
    );
  });

  it('flips at every header bottom measured, and the band grows with it', () => {
    // 44, 54, 64 and 87 are what the header computes to at 100, 125, 150 and
    // 200 per cent scaling. The point is that the branch follows the argument:
    // a selection that fits above a 44 px header does not fit above an 87 px
    // one, and the same call answers differently.
    const selectionTop = 44 + TOOLBAR_H + GAP; // exactly clears a 44 px header
    const selectionBottom = selectionTop + 27.19;

    expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, 44)).toBeCloseTo(44, 5);
    for (const headerBottom of [54, 64, 87]) {
      expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom)).toBeCloseTo(
        selectionBottom + GAP,
        5,
      );
    }
  });

  it('never returns a top that overlaps the header', () => {
    // Both branches, swept across the band and past it. Either the toolbar ends
    // at or below the header bottom, or it is under the selection entirely.
    const headerBottom = 54;
    for (let selectionTop = headerBottom; selectionTop <= headerBottom + 120; selectionTop += 0.5) {
      const selectionBottom = selectionTop + 27.19;
      const top = toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom);
      const clearAbove = top >= headerBottom && top + TOOLBAR_H <= selectionTop;
      const below = top >= selectionBottom;
      expect(clearAbove || below).toBe(true);
    }
  });
});

describe('toolbarTop — the two boundaries (#268)', () => {
  it('stays above when the room is exactly what is needed', () => {
    const headerBottom = 64;
    const selectionTop = headerBottom + TOOLBAR_H + GAP;
    expect(toolbarTop(selectionTop, selectionTop + 27.19, TOOLBAR_H, headerBottom)).toBeCloseTo(
      headerBottom,
      5,
    );
  });

  it('flips when the room is one pixel short of what is needed', () => {
    const headerBottom = 64;
    const selectionTop = headerBottom + TOOLBAR_H + GAP - 1;
    const selectionBottom = selectionTop + 27.19;
    expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom)).toBeCloseTo(
      selectionBottom + GAP,
      5,
    );
  });
});
