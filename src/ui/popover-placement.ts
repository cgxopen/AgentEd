/**
 * Where a popover opens against the control that opened it (#267, #272).
 *
 * Three callers, and the arithmetic is the same for all of them:
 *
 * - **the heading list**, against the floating toolbar (`heading-levels.ts`);
 * - **the language popover**, against the label of a fenced block
 *   (`language-popover.ts`);
 * - **the emoji palette**, against the caret (`emoji-palette.ts`, #296).
 *
 * It was written for the first in #267 and moved here in #272, when the second
 * turned out to need exactly it: nothing in the body knows what the anchor is.
 *
 * **None of the placement on screen is observable in the test harness**, which
 * reports every rectangle as zero. This file takes numbers and returns numbers,
 * so it is asserted directly in `popover-placement.test.ts`, and each caller is
 * verified in the manual pass.
 */

/** Between the anchor and the popover. */
export const POPOVER_OFFSET = 4;

/** Between the popover and the window edge. */
export const POPOVER_MARGIN = 8;

export interface PopoverPlacement {
  /** Viewport `top` for the popover. */
  readonly top: number;
  /** What it may occupy; a popover taller than this scrolls inside it. */
  readonly maxHeight: number;
  /** Above the anchor rather than below it. Read by the tests and the callers. */
  readonly above: boolean;
}

/**
 * Below the anchor when the popover fits there, above it when it does not, and
 * on the roomier of the two capped to that room when it fits neither.
 *
 * The header bottom is the ceiling for the same reason it is in `toolbarTop`: a
 * popover that clamped to the window top instead would draw across the header,
 * which is the defect #268 repaired one module away. The header has no declared
 * height and is 44, 54, 64 and 87 px at 100, 125, 150 and 200 per cent display
 * scaling, which is why it is an argument.
 *
 * ── Why the third branch exists, with the numbers that put it there ──
 *
 * Measured in #267 with the heading list, 240 by 203 px, across every visible
 * line at several scroll positions:
 *
 * - 1200x800, 678 selections: 74 per cent below, 26 per cent above, **none
 *   capped**.
 * - 1024x768, 651 selections: 73 per cent below, 27 per cent above, **none
 *   capped**.
 * - 600x400, 196 selections: 48 per cent below, 27 per cent above, **24 per
 *   cent capped**.
 *
 * So the third branch exists for the minimum `src-tauri/tauri.conf.json`
 * declares, where the visible text is 356 px tall against a list wanting 207
 * with its offset. In the capped cases there the roomier side holds a minimum
 * of **154.5 px**, which shows five of the seven rows and scrolls for the rest.
 *
 * **The language popover never reaches it.** Measured in #272 with the height
 * it has once a refusal is shown, 84.6 px, over every position a block label
 * occupied while scrolling: 0 of 6569 positions across 1200x800, 1024x768 and
 * 600x400 at three header heights.
 *
 * ── The band, and the two facts it answers (#296) ──
 *
 * The four branches assume the anchor sits between the header and the window
 * edge. The emoji palette was the first caller to break that assumption, and
 * its step zero measured what the branches did then:
 *
 * - **an anchor scrolled out of the window gave a popover drawn wholly outside
 *   it**, top at -2380 or +1908 px at 600x400, because each branch places the
 *   popover against the anchor wherever the anchor is;
 * - **an anchor as tall as the window gave a max height of 0**, since neither
 *   side then has room, which at 600x400 was an 18 px strip.
 *
 * So the result of the branches is kept inside the band between the header
 * and the window edge. **For an anchor inside the band this changes nothing**:
 * every branch already lands inside it. The two callers before the palette
 * were re-swept rather than assumed unchanged, and no sampled position moved:
 * 13961 label positions of the language popover, each with and without a
 * refusal, and 5256 toolbar positions of the heading list, 830 of them on the
 * capped branch. Where neither side has any room at all the popover covers
 * the anchor instead, from the header down; `above` is left as the branches
 * chose it, because the language popover reads nothing else.
 *
 * A popover still loses rows when an anchor leaves little room on both sides:
 * a room of 1 px is a room. Only the case of none is answered.
 */
export function popoverPlacement(
  anchorTop: number,
  anchorBottom: number,
  height: number,
  headerBottom: number,
  viewportHeight: number,
): PopoverPlacement {
  const below = anchorBottom + POPOVER_OFFSET;
  const roomBelow = viewportHeight - POPOVER_MARGIN - below;
  const roomAbove = anchorTop - POPOVER_OFFSET - headerBottom;
  const band = Math.max(0, viewportHeight - POPOVER_MARGIN - headerBottom);

  if (roomBelow <= 0 && roomAbove <= 0) {
    return { top: headerBottom, maxHeight: Math.min(height, band), above: roomAbove > roomBelow };
  }
  return withinBand(
    sideOf(anchorTop, below, height, roomBelow, roomAbove, headerBottom),
    headerBottom,
    viewportHeight,
    band,
  );
}

/** The four branches, as they were before #296. */
function sideOf(
  anchorTop: number,
  below: number,
  height: number,
  roomBelow: number,
  roomAbove: number,
  headerBottom: number,
): PopoverPlacement {
  if (height <= roomBelow) return { top: below, maxHeight: height, above: false };
  if (height <= roomAbove) {
    return { top: anchorTop - POPOVER_OFFSET - height, maxHeight: height, above: true };
  }
  if (roomBelow >= roomAbove) {
    return { top: below, maxHeight: Math.max(0, roomBelow), above: false };
  }
  return { top: headerBottom, maxHeight: Math.max(0, roomAbove), above: true };
}

/** No taller than the band, and starting where it ends inside it. */
function withinBand(
  placement: PopoverPlacement,
  headerBottom: number,
  viewportHeight: number,
  band: number,
): PopoverPlacement {
  const maxHeight = Math.min(placement.maxHeight, band);
  const top = Math.min(
    Math.max(placement.top, headerBottom),
    viewportHeight - POPOVER_MARGIN - maxHeight,
  );
  return { top, maxHeight, above: placement.above };
}
