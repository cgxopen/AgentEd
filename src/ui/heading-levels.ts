/**
 * The list of heading levels behind the toolbar heading control (#267).
 *
 * ── Which of the four popovers this follows, and why ──
 *
 * `src/ui` carries four, and reading them puts them in two families.
 * `appearance-menu.ts`, `cluster-popover.ts` and `assets-popover.ts` are static
 * elements in `index.html` placed by a CSS rule against a header that never
 * moves. `language-popover.ts` is built on demand, appended to the body, and
 * **positioned in JavaScript against an anchor rect** — the only one whose
 * anchor moves. The floating toolbar moves with every selection, so this
 * follows `language-popover.ts`: same one-open-at-a-time module state, same
 * capture-phase mousedown for the click outside, same Escape.
 *
 * ── What it does that `language-popover` does not ──
 *
 * That one opens downward and clamps horizontally only. Measured on `74cce43`
 * with a list of this height: opening downward alone runs off the bottom of
 * the window for **24 per cent** of selections at 1200x800 and **48 per cent**
 * at the 600x400 minimum. So this one chooses a side, and caps.
 *
 * ── Focus stays in the editor, and that is load-bearing ──
 *
 * Nothing here takes DOM focus. `bindToolbarEvents` hides the toolbar 150 ms
 * after the editor blurs unless the pointer is over it, so a list that took
 * focus would pull the toolbar out from under itself. The toolbar buttons
 * already call `preventDefault` on mousedown for the same reason; the entries
 * here do too, and the arrow keys are served by a document-level listener that
 * lives only while the list is open.
 */

/** The class the stylesheet draws and positions the list with. */
export const HEADING_LEVELS_CLASS = 'heading-levels';

/** One row of it. */
export const HEADING_LEVEL_OPTION_CLASS = 'heading-levels-option';

/** The row the arrow keys are on. */
export const HEADING_LEVEL_ACTIVE_CLASS = 'active';

/** Between the toolbar and the list, and between the list and the window edge. */
const OFFSET = 4;
const MARGIN = 8;

export interface HeadingChoice {
  /** What the row reads. */
  readonly label: string;
  /** The level to set, or `null` for ordinary body text. */
  readonly level: 1 | 2 | 3 | 4 | 5 | 6 | null;
}

/**
 * What the list offers: the six levels the schema holds since #263, and the
 * way back to body text.
 *
 * The seventh row surfaces a route that already works rather than inventing
 * one — measured in a real browser on `74cce43`, `Ctrl+Alt+1` through
 * `Ctrl+Alt+6` produce H1 through H6 and `Ctrl+Alt+0` produces a paragraph.
 * The toolbar has never offered either.
 */
export const HEADING_CHOICES: ReadonlyArray<HeadingChoice> = [
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
  { label: 'Heading 4', level: 4 },
  { label: 'Heading 5', level: 5 },
  { label: 'Heading 6', level: 6 },
  { label: 'Body text', level: null },
];

export interface ListPlacement {
  /** Viewport `top` for the list. */
  readonly top: number;
  /** What it may occupy; the list scrolls inside this. */
  readonly maxHeight: number;
  /** Above the toolbar rather than below it. Read by the tests and the caller. */
  readonly above: boolean;
}

/**
 * Where the list goes, as arithmetic that can be read without a browser.
 *
 * Below the toolbar when it fits there, above it when it does not, and on the
 * roomier of the two capped to that room when it fits neither. The header
 * bottom is the ceiling for the same reason it is in `toolbarTop`: a list that
 * clamped to the window top instead would draw across the header, which is the
 * defect #268 repaired one module away.
 *
 * ── Why the third branch exists, with the numbers that put it there ──
 *
 * Measured on this branch, with the list this file actually renders — 240 by
 * 203 px, seven rows — across every visible line at several scroll positions:
 *
 * - 1200x800, 678 selections: 74 per cent below, 26 per cent above, **none
 *   capped**.
 * - 1024x768, 651 selections: 73 per cent below, 27 per cent above, **none
 *   capped**.
 * - 600x400, 196 selections: 48 per cent below, 27 per cent above, **24 per
 *   cent capped**.
 *
 * So at ordinary window sizes the first two branches are the whole story, and
 * the third exists for the minimum `src-tauri/tauri.conf.json` declares, where
 * the visible text is 356 px tall against a list wanting 207 with its offset.
 * In the capped cases there the roomier side holds a minimum of **154.5 px**,
 * which shows five of the seven rows and scrolls for the rest.
 *
 * `maxHeight` is floored at 0 rather than allowed to go negative. That is
 * arithmetic hygiene: the smallest room measured at the declared minimum window
 * was 154.5 px, and nothing has produced a negative one.
 */
export function headingListPlacement(
  toolbarTop: number,
  toolbarBottom: number,
  listHeight: number,
  headerBottom: number,
  viewportHeight: number,
): ListPlacement {
  const below = toolbarBottom + OFFSET;
  const roomBelow = viewportHeight - MARGIN - below;
  const roomAbove = toolbarTop - OFFSET - headerBottom;

  if (listHeight <= roomBelow) return { top: below, maxHeight: listHeight, above: false };
  if (listHeight <= roomAbove) {
    return { top: toolbarTop - OFFSET - listHeight, maxHeight: listHeight, above: true };
  }
  if (roomBelow >= roomAbove) {
    return { top: below, maxHeight: Math.max(0, roomBelow), above: false };
  }
  return { top: headerBottom, maxHeight: Math.max(0, roomAbove), above: true };
}

export interface HeadingLevelsOptions {
  /** The control the list hangs off, and the toolbar it sits in. */
  readonly anchor: HTMLElement;
  readonly toolbar: HTMLElement;
  /** The level the caret is in, so the list can mark it. */
  readonly current: HeadingChoice['level'];
  /** A row was chosen. The caller makes the change. */
  readonly onChoose: (choice: HeadingChoice) => void;
}

export interface HeadingLevels {
  readonly element: HTMLElement;
  readonly close: () => void;
}

/**
 * The one list on screen, so a second click cannot leave the first behind.
 * Module state rather than a parameter, as in `language-popover.ts`: there is
 * one pointer and one document.
 */
let open: HeadingLevels | null = null;

/** Whatever is open now, or `null`. Read by the tests and by the caller. */
export function activeHeadingLevels(): HeadingLevels | null {
  return open;
}

/** Close whatever is open. Safe to call when nothing is. */
export function closeHeadingLevels(): void {
  open?.close();
}

export function openHeadingLevels(options: HeadingLevelsOptions): HeadingLevels {
  closeHeadingLevels();

  const element = document.createElement('div');
  element.className = HEADING_LEVELS_CLASS;
  // Chrome, outside the editable tree: appended to the body, so no caret can
  // enter it and no serializer can see it.
  element.setAttribute('role', 'menu');
  element.setAttribute('aria-label', 'Heading level');

  const rows: HTMLButtonElement[] = [];
  let index = Math.max(
    0,
    HEADING_CHOICES.findIndex((c) => c.level === options.current),
  );

  function highlight(next: number): void {
    index = (next + rows.length) % rows.length;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle(HEADING_LEVEL_ACTIVE_CLASS, i === index);
    }
    // The list scrolls when it is capped, so the arrow keys have to bring the
    // row they moved to into view or they walk off the visible part of it.
    rows[index].scrollIntoView({ block: 'nearest' });
  }

  function finish(): void {
    element.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (open?.element === element) open = null;
  }

  function choose(choice: HeadingChoice): void {
    finish();
    options.onChoose(choice);
  }

  function onOutside(event: MouseEvent): void {
    if (event.target instanceof Node && element.contains(event.target)) return;
    if (event.target instanceof Node && options.anchor.contains(event.target)) return;
    finish();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(index + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(index - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      highlight(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      highlight(rows.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(HEADING_CHOICES[index]);
    }
  }

  for (const choice of HEADING_CHOICES) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = HEADING_LEVEL_OPTION_CLASS;
    row.textContent = choice.label;
    row.setAttribute('role', 'menuitem');
    if (choice.level === options.current) row.setAttribute('aria-current', 'true');
    // `preventDefault` for the same reason the toolbar buttons do it: the
    // selection this acts on must survive the click.
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      choose(choice);
    });
    element.appendChild(row);
    rows.push(row);
  }

  document.body.appendChild(element);
  position(element, options.toolbar);
  highlight(index);

  // Captured, so a click anywhere else closes this before that click does
  // anything else. Keydown is captured for the same reason: the editor keeps
  // focus while the list is open, so an uncaptured listener would see the
  // arrow keys only after ProseMirror had moved the caret with them.
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);

  open = { element, close: finish };
  return open;
}

/**
 * Put it against the toolbar and keep it on screen.
 *
 * `position: fixed` in the stylesheet, so these are viewport coordinates.
 * The horizontal clamp is the same shape `language-popover` uses; the vertical
 * one is `headingListPlacement`, which is where the arithmetic is asserted.
 *
 * **None of this is observable in the test harness**, which reports every
 * rectangle as zero. It is verified in the manual pass and by the numbers
 * measured in Chromium on the branch, not by an assertion here.
 */
function position(element: HTMLElement, toolbar: HTMLElement): void {
  const anchor = toolbar.getBoundingClientRect();
  const header = document.getElementById('menubar');
  // `#menubar` is written in `index.html`. If it is ever absent this falls back
  // to the window top as the ceiling, which is what the list would have done
  // before #268 taught this file to read it.
  const headerBottom = header === null ? 0 : header.getBoundingClientRect().bottom;

  // Measured before it is placed: the element is in the document and unhidden,
  // so this is a real box. The lesson is #265 and it is one module away.
  const listHeight = element.getBoundingClientRect().height;
  const placement = headingListPlacement(
    anchor.top,
    anchor.bottom,
    listHeight,
    headerBottom,
    window.innerHeight,
  );

  const width = element.getBoundingClientRect().width;
  const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN));
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(placement.top)}px`;
  element.style.maxHeight = `${Math.round(placement.maxHeight)}px`;
}
