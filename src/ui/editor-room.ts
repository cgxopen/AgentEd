/**
 * The room the editor has, and how a floating surface is kept inside it (#350).
 *
 * Four surfaces hang over the document — the floating toolbar, the heading
 * list, the emoji palette and the language popover — and each of them clamped
 * itself against `window.innerWidth`. That was the same number as the editor
 * until #347 put the files panel beside the editor rather than over it: since
 * then the window is the editor **plus** the panel, so a surface placed near
 * the right of the text was drawn on top of the panel card. Measured in
 * Chromium on `3ff4d55`, panel open, worst case: the bar 102.4 px over the card
 * at 1024x768, 99.9 at 600x400 and 108.5 at 150 per cent scaling, and the emoji
 * palette 220 px at all three, which is the whole width of the card.
 *
 * **This module is two halves and they are separated on purpose.** `withinRoom`
 * takes numbers and returns a number, so rows assert it directly, the way
 * `toolbarTop` is asserted in `toolbar-placement.ts`. `editorRoom` reads the
 * DOM, and what it returns depends on layout the test harness does not perform.
 * Neither half is worth much without the other, and the join is the manual pass.
 */

/** The horizontal room a floating surface may occupy, in viewport coordinates. */
export interface Room {
  readonly left: number;
  readonly right: number;
}

/**
 * The room the editor has, which is the whole window until the files panel is
 * open and the editor stack narrower than it.
 *
 * **`#editor-stack` is the element read, and it is the flex sibling of the
 * panel** — so its right edge *is* the edge of the room rather than something
 * that tracks it. `#editor` inside it measured identical at every size, with
 * the search panel open and with the metadata panel open, and was left as the
 * coincidence it is. `.ProseMirror` was measured and rejected: it is the text
 * column, 40 px in from the editor with the panel open and 152 px in at
 * 1024x768 with it closed, so reading it would move all four surfaces on the
 * closed path too, which the acceptance forbids.
 *
 * **With the panel closed this returns exactly the window**, measured at all
 * three sizes — so the placement with no panel open is the arithmetic that
 * shipped before this change, by construction rather than by a branch that
 * tells the two states apart.
 *
 * `#editor-stack` is written in `index.html`. If it is ever absent this falls
 * back to the window, which is the behaviour before this change rather than a
 * guard against it — the same shape the header-bottom read uses one module over.
 */
export function editorRoom(): Room {
  const stack = document.getElementById('editor-stack');
  if (stack === null) return { left: 0, right: window.innerWidth };
  const rect = stack.getBoundingClientRect();
  return { left: rect.left, right: rect.right };
}

/**
 * The `left` a surface of `width` takes when it wants to start at
 * `desiredLeft`, kept inside the room with `margin` to spare at each end.
 *
 * **When the surface is wider than the room the left bound wins and the surface
 * spills to the right**, which is the owner decision of 2026-09-18 rather than
 * an accident of the arithmetic. It is reached at exactly one measured state:
 * the bar with an image selected is 372.7 px against 372 px of room at 600x400
 * with the panel open, so it overhangs the card by 8.7 px. The alternatives
 * were built and put with their costs — spilling left puts the first button of
 * the bar off the window where it cannot be pressed, which costs a command
 * rather than an appearance, and centring it in the room overhangs 0.35 px at
 * each end at the cost of touching both. **The order of these two calls is what
 * decides that**, which is why swapping them is a reversal this change owes.
 */
export function withinRoom(desiredLeft: number, width: number, room: Room, margin: number): number {
  return Math.max(room.left + margin, Math.min(desiredLeft, room.right - width - margin));
}
