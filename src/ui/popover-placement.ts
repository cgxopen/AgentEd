/**
 * Where a popover opens against the control that opened it (#267, #272).
 *
 * Two callers, and the arithmetic is the same for both:
 *
 * - **the heading list**, against the floating toolbar (`heading-levels.ts`);
 * - **the language popover**, against the label of a fenced block
 *   (`language-popover.ts`).
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
 * `maxHeight` is floored at 0 rather than allowed to go negative. That is
 * arithmetic hygiene: the smallest room measured at the declared minimum window
 * was 154.5 px, and nothing has produced a negative one.
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

  if (height <= roomBelow) return { top: below, maxHeight: height, above: false };
  if (height <= roomAbove) {
    return { top: anchorTop - POPOVER_OFFSET - height, maxHeight: height, above: true };
  }
  if (roomBelow >= roomAbove) {
    return { top: below, maxHeight: Math.max(0, roomBelow), above: false };
  }
  return { top: headerBottom, maxHeight: Math.max(0, roomAbove), above: true };
}
