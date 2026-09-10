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
 * ── Why the header bottom is an argument rather than a constant ──
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
 * inside the header. The header bottom is the floor instead. At every scaling
 * measured it is larger than the 8 px that clamp used, so it is the binding
 * bound in this application; this function does not itself guarantee a result
 * clear of the window top for a caller that passes a header bottom of 0, and
 * such a caller gets the pre-#268 behaviour rather than a guard.
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
 */
export function toolbarTop(
  selectionTop: number,
  selectionBottom: number,
  toolbarHeight: number,
  headerBottom: number,
): number {
  const above = selectionTop - toolbarHeight - GAP;
  if (above >= headerBottom) return above;
  return selectionBottom + GAP;
}
