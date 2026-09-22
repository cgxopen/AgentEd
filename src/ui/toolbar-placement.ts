/**
 * Where the floating toolbar sits vertically — arithmetic, kept apart from the
 * DOM so it can be read without a browser (#268).
 *
 * **This module is the only part of the placement that a test can see.** The
 * harness performs no layout: `getBoundingClientRect` answers 0 for every box
 * and `coordsAtPos` answers nothing useful, so a test that built a toolbar and
 * asked where it landed would be asserting nothing. Taking the three measured
 * values as arguments moves the arithmetic somewhere assertions can reach it.
 * What stays out of reach is the wiring — that the caller passes the *real*
 * header bottom is verified by hand on Windows and by nothing here.
 */

/** The breathing space between the toolbar and the text it acts on. */
const GAP = 8;

/**
 * The `top` the toolbar should take, in viewport coordinates.
 *
 * Above the selection when it fits clear of the header, and below the
 * selection when it does not.
 *
 * ── Why the top of the room is an argument rather than a constant ──
 *
 * It is not a constant anywhere in this application. `#menubar` declares no
 * height in `src/styles.css`; the 44 px it computes to comes from its tallest
 * child. Measured on the shipped build: **44 at 100 per cent scaling, and 54,
 * 64 and 87 at 125, 150 and 200**. A number written down here would be wrong
 * at every scaling but one, and the owner machine runs at 150.
 *
 * ── Why nothing clamps to the window top any more ──
 *
 * The expression this replaces was `Math.max(8, top)`, which knew only the top
 * of the window — which is how a correctly measured toolbar came to be drawn
 * inside the header. The top of the room is the floor instead. At every scaling
 * measured it is larger than the 8 px that clamp used, so it is the binding
 * bound in this application; this function does not itself guarantee a result
 * clear of the window top for a caller that passes a room top of 0, and such a
 * caller gets the pre-#268 behaviour rather than a guard.
 *
 * ── Why the room rather than the header (#416) ──
 *
 * It was the header bottom until #416, and the header stopped being the top of
 * the room the day anything could sit between it and the text. With the
 * metadata panel shown the bar cleared the header and was drawn **over the
 * panel**: measured with it collapsed, its bottom at 71, the selection in the
 * first line at 87 and the bar wanting 47. The caller passes the top of
 * `#editor`, which is the bottom of whatever is above it; with no panel shown
 * that is the header bottom, so nothing about the placement without one moved.
 *
 * ── The flip, and what it costs ──
 *
 * Below the selection costs the line underneath it, which is worth less than
 * the line being worked on. Measured before it was built: across every visible
 * line at 600x400 and 1200x800, 37 selections had no room above and **none of
 * them lacked room below** — the tightest left 223 px to spare. The flip is
 * only reached near the top of the viewport, where the rest of the window is
 * underneath. A window would have to be about 150 px tall for both to fail,
 * against the 400 px minimum `tauri.conf.json` declares.
 *
 * ── The band, and how it composes with the measurement above (#336) ──
 *
 * **The flip stays exactly as it is and the band clamps its result.** They are
 * not alternatives, and the paragraph above is not contradicted by the one
 * below: that sweep was taken over selections that **fit on the screen**, and
 * for those the clamp never fires. What it answers is the case outside the
 * sweep, which nobody had swept.
 *
 * A selection whose start is scrolled above the viewport cannot take the first
 * branch at all — `selectionTop` is small or negative, so nothing clears the
 * header — and the second branch then measures from a selection bottom that
 * has been scrolled to the foot of the window. Measured on `6205bd1`: **40.0 px
 * below the window** on a whole-document selection at 1024x768 and at 600x400,
 * at every scroll position, and **39.1 px below** on a 24-line selection at the
 * default window, **14.5 px** on a 10-line one at the minimum. Before this the
 * function took no window height, so no argument it received could have told it
 * where the window ended; that is the whole of the defect.
 *
 * **Why the clamp is written here rather than taken from `popoverPlacement`,**
 * which has kept three popovers inside a band since #296. Three things make it
 * a shape to borrow rather than a function to call:
 *
 * - it returns a `maxHeight` as well as a `top`, because a popover taller than
 *   its room scrolls inside itself; **the toolbar is one fixed height and has
 *   nothing to cap**;
 * - a popover sits beside the control that opened it and never covers what it
 *   acts on, while a clamped toolbar sits **over the text of the selection it
 *   acts on**, for exactly the selections with no free edge — a consequence
 *   with no counterpart there, and one the manual pass judges by eye;
 * - where the band is shorter than the thing being placed the popover shrinks
 *   and the toolbar cannot, so the two want opposite answers at that boundary.
 *
 * **Where a selection too tall for either side puts the bar: the top of the
 * band.** Owner decision of 2026-09-17, taken on the artifact of the first
 * head, where the clamp had put it at the **bottom** of the band instead. His
 * report is the mechanism exactly: dragging past the foot of the window left
 * the bar at the bottom, and shortening the selection by one line at the top
 * let the first branch fire again and the bar went back above.
 *
 * Both edges cover selected text — that is what a selection with no free edge
 * means — so the choice is which line to cover. The top covers the first
 * visible line of the selection and sits against the header, where it reads as
 * part of it; the bottom covers the last visible line, which after a downward
 * drag is where the pointer just stopped and where the eye is.
 *
 * **The counter-case, recorded rather than left to be discovered**: a drag made
 * upwards ends with the pointer at the top, and there the bar now appears under
 * it. Nothing here measures which drag is the common one, and this is a look
 * the owner judges rather than a figure.
 *
 * **The flip is untouched for every case the sweep above covered.** The third
 * branch is only reached when the second one would leave the window, and that
 * sweep found no selection lacking room below — so for all 37 of them, and for
 * every selection that fits on screen, this function answers exactly what it
 * answered before #336.
 *
 * **What happens to the older reading, that the header floor wins when the two
 * bounds cross.** It no longer arises: the third branch returns the header
 * bottom outright rather than clamping between two bounds that could cross, so
 * the bar can never be drawn into the header — the defect #268 exists for —
 * whatever the window is. A window shorter than the bar and its gaps leaves the
 * bar overflowing the foot, which is the same preference stated more simply.
 */
export function toolbarTop(
  selectionTop: number,
  selectionBottom: number,
  toolbarHeight: number,
  roomTop: number,
  viewportHeight: number,
): number {
  const above = selectionTop - toolbarHeight - GAP;
  if (above >= roomTop) return above;

  const below = selectionBottom + GAP;
  if (below + toolbarHeight <= viewportHeight - GAP) return below;

  return roomTop;
}
