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

/**
 * A window tall enough that the band below never fires, so every row written
 * before #336 keeps the meaning it had: each of them is about the flip and the
 * header floor, and a clamp firing in the middle of one would change what it
 * asserts without anyone noticing. The rows that are about the band say so and
 * pass their own window.
 */
const ROOMY = 768;

describe('toolbarTop — above the selection when there is room (#268)', () => {
  it('sits its own height plus the gap above the selection', () => {
    // Room to spare: a selection in the middle of the document.
    expect(toolbarTop(400, 427.19, TOOLBAR_H, 44, ROOMY)).toBeCloseTo(400 - TOOLBAR_H - GAP, 5);
  });

  it('is unaffected by the selection bottom while it fits above', () => {
    // The ordinary case must not move when the flip is added — the bottom is
    // read only on the other branch.
    const a = toolbarTop(400, 427.19, TOOLBAR_H, 44, ROOMY);
    const b = toolbarTop(400, 900, TOOLBAR_H, 44, ROOMY);
    expect(a).toBe(b);
  });

  it('takes the header bottom as its floor, not the window top', () => {
    // The defect: `Math.max(8, top)` knew only the window top, so a correctly
    // measured toolbar was placed inside the header.
    //
    // **This row asserted only `>= headerBottom` until #336**, which the band
    // clamp now guarantees on every branch — so it would have gone on passing
    // whatever the branches did. It asserts the value instead: with room to
    // spare the answer is the selection top less the bar and the gap, and
    // nothing else. Named in the brief as one of two rows standing loose beside
    // the sweeps; made to discriminate rather than left.
    for (const headerBottom of [44, 54, 64, 87]) {
      const selectionTop = headerBottom + TOOLBAR_H + GAP + 100;
      expect(
        toolbarTop(selectionTop, selectionTop + 27, TOOLBAR_H, headerBottom, ROOMY),
      ).toBeCloseTo(selectionTop - TOOLBAR_H - GAP, 5);
    }
  });
});

describe('toolbarTop — below the selection when there is not (#268)', () => {
  it('flips to the gap under the selection inside the band', () => {
    // A selection close under the header: 10 px of room where 39.59 is needed.
    const headerBottom = 44;
    const selectionTop = headerBottom + 10;
    const selectionBottom = selectionTop + 27.19;
    expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom, ROOMY)).toBeCloseTo(
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

    expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, 44, ROOMY)).toBeCloseTo(44, 5);
    for (const headerBottom of [54, 64, 87]) {
      expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom, ROOMY)).toBeCloseTo(
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
      const top = toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom, ROOMY);
      const clearAbove = top >= headerBottom && top + TOOLBAR_H <= selectionTop;
      const below = top >= selectionBottom;
      expect(clearAbove || below).toBe(true);
      // The other half, added with the band (#336): whichever branch answered,
      // the bar is whole inside the window. Before this the sweep could not
      // have caught a result below the window edge, because the function had
      // no window to be below.
      expect(top + TOOLBAR_H).toBeLessThanOrEqual(ROOMY - GAP);
    }
  });
});

describe('toolbarTop — the two boundaries (#268)', () => {
  it('stays above when the room is exactly what is needed', () => {
    const headerBottom = 64;
    const selectionTop = headerBottom + TOOLBAR_H + GAP;
    expect(
      toolbarTop(selectionTop, selectionTop + 27.19, TOOLBAR_H, headerBottom, ROOMY),
    ).toBeCloseTo(headerBottom, 5);
  });

  it('flips when the room is one pixel short of what is needed', () => {
    const headerBottom = 64;
    const selectionTop = headerBottom + TOOLBAR_H + GAP - 1;
    const selectionBottom = selectionTop + 27.19;
    expect(toolbarTop(selectionTop, selectionBottom, TOOLBAR_H, headerBottom, ROOMY)).toBeCloseTo(
      selectionBottom + GAP,
      5,
    );
  });
});

describe('toolbarTop — the band, for a selection taller than the window (#336)', () => {
  /**
   * **Every row here is built on a selection that is tall but is not the whole
   * document**, which is deliberate rather than incidental. A whole-document
   * selection is also a selection taller than the screen, so a band row written
   * on select-all would be satisfied by the hide in `toolbar.ts` and the two
   * changes would not be independently witnessed. A drag of 24 lines is the
   * shape these use, and no selection type reaches this function at all — it
   * takes four numbers and a window.
   */
  it('keeps the bar whole inside the window when the flip would put it past the foot', () => {
    // The measured case at the default window: the selection start scrolled far
    // above the viewport, its end at the foot, which before the band returned
    // 776.4 in a 768 px window — 40.0 px below it, which is what was measured on
    // the running application at 6205bd1.
    const headerBottom = 44;
    const viewportHeight = 768;
    const selectionBottom = 768.4;
    const unclamped = selectionBottom + GAP;
    expect(unclamped).toBeCloseTo(776.4, 5);

    const top = toolbarTop(-2000, selectionBottom, TOOLBAR_H, headerBottom, viewportHeight);
    expect(top).toBeCloseTo(viewportHeight - GAP - TOOLBAR_H, 5);
    expect(top).toBeCloseTo(728.41, 2);
    expect(top + TOOLBAR_H).toBeLessThanOrEqual(viewportHeight);
  });

  it('does the same at the minimum window, where the band is shorter', () => {
    // 408.4 in a 400 px window before the band, which is the 600x400 figure.
    const top = toolbarTop(-2000, 400.4, TOOLBAR_H, 44, 400);
    expect(top).toBeCloseTo(400 - GAP - TOOLBAR_H, 5);
    expect(top).toBeCloseTo(360.41, 2);
  });

  it('reads the window height rather than assuming one', () => {
    // The same selection in two windows must not give the same answer. This is
    // the row that a constant in place of `window.innerHeight` would redden —
    // the wiring itself cannot be reached here, and is the manual pass.
    const tall = toolbarTop(-2000, 900, TOOLBAR_H, 44, 768);
    const short = toolbarTop(-2000, 900, TOOLBAR_H, 44, 400);
    expect(tall).not.toBeCloseTo(short, 5);
    expect(tall - short).toBeCloseTo(368, 5);
  });

  it('leaves an ordinary selection exactly where it was', () => {
    // The band must be invisible to everything that already fitted. A selection
    // in the middle of a comfortable window takes the above branch and the
    // clamp does not touch it.
    for (const headerBottom of [44, 54, 64, 87]) {
      const selectionTop = headerBottom + 300;
      expect(
        toolbarTop(selectionTop, selectionTop + 27.19, TOOLBAR_H, headerBottom, 768),
      ).toBeCloseTo(selectionTop - TOOLBAR_H - GAP, 5);
    }
  });

  it('keeps the header floor when the two bounds cross', () => {
    // A window too short to hold the bar below the header at all. The stated
    // preference: the bar overflows the foot rather than being drawn into the
    // header, which is the defect #268 exists for. It needs a window about
    // 127 px tall against the 400 px minimum, so this pins the choice rather
    // than guarding a reachable state.
    const headerBottom = 87;
    const viewportHeight = 100;
    expect(viewportHeight - GAP - TOOLBAR_H).toBeLessThan(headerBottom);
    expect(toolbarTop(400, 500, TOOLBAR_H, headerBottom, viewportHeight)).toBe(headerBottom);
  });
});
