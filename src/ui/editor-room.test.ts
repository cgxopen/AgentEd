/**
 * The room the editor has, and the four surfaces kept inside it (#350).
 *
 * **Said first: where a surface lands on screen is not observable here.**
 * happy-dom performs no layout and answers 0 for every rectangle, so nothing
 * below sees a pixel of the real thing. The figures that decided this change
 * were measured in Chromium on the built page and are written on the issue, and
 * the manual pass is where the repair is verified.
 *
 * What these rows do assert is both halves of the mechanism, separately:
 *
 * - **`withinRoom` takes numbers and returns a number**, so it is asserted
 *   directly, the way `toolbarTop` is in `toolbar-placement.test.ts`;
 * - **each of the four callers reads the room rather than the window**, which is
 *   normally the half no test in this repository can see. STATUS section 4
 *   records the shape: on #270 the header-bottom read was replaced with the
 *   constant 44 and all 2786 tests stayed green, because the arithmetic cannot
 *   see where its caller found its arguments.
 *
 * **That half is witnessed here, and it was predicted not to be.** The issue and
 * the brief both expected a zero. What makes it reachable is that happy-dom lets
 * a rectangle be stubbed and `window.innerWidth` be assigned, so the room and
 * the window can be given **different** numbers — and then which of the two a
 * caller read is visible in the `left` it writes. The room and the window are
 * the same number on a real screen whenever the panel is closed, which is why
 * this needs arranging rather than merely observing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import { editorRoom, withinRoom } from './editor-room';
import { activeEmojiPalette, openEmojiPalette } from './emoji-palette';
import { closeHeadingLevels, openHeadingLevels } from './heading-levels';
import { closeLanguagePopover, openLanguagePopover } from './language-popover';
import { POPOVER_MARGIN } from './popover-placement';
import { setupToolbar } from './toolbar';

// ─────────────────────────────────────────────────────────────────────────────
// withinRoom — numbers in, a number out
// ─────────────────────────────────────────────────────────────────────────────

/** The room the editor has at 1024x768 with the files panel open, measured. */
const ROOM_WITH_PANEL = { left: 0, right: 796 };
/** The same window with the panel closed, where the room is the window. */
const ROOM_WITHOUT_PANEL = { left: 0, right: 1024 };

describe('withinRoom keeps a surface inside the room it is given', () => {
  it('leaves a surface that fits where it wants to be', () => {
    expect(withinRoom(200, 240, ROOM_WITH_PANEL, POPOVER_MARGIN)).toBe(200);
  });

  it('pulls a surface back off the right edge, by the width and the margin', () => {
    // 796 - 240 - 8. Anything further right lands here.
    expect(withinRoom(700, 240, ROOM_WITH_PANEL, POPOVER_MARGIN)).toBe(548);
    expect(withinRoom(100_000, 240, ROOM_WITH_PANEL, POPOVER_MARGIN)).toBe(548);
  });

  it('pushes a surface off the left edge back to the margin', () => {
    expect(withinRoom(-500, 240, ROOM_WITH_PANEL, POPOVER_MARGIN)).toBe(8);
    expect(withinRoom(0, 240, ROOM_WITH_PANEL, POPOVER_MARGIN)).toBe(8);
  });

  it('is the arithmetic that shipped before, whenever the room is the window', () => {
    // The regression half of the acceptance, as arithmetic: with no panel open
    // the room is the whole window, so every answer is the one `Math.max(8,
    // Math.min(desired, innerWidth - width - 8))` gave. Two of the three
    // branches, plus a value in the middle.
    const shipped = (desired: number, width: number, innerWidth: number) =>
      Math.max(8, Math.min(desired, innerWidth - width - 8));
    for (const desired of [-500, 0, 8, 200, 700, 776, 900, 100_000]) {
      expect(withinRoom(desired, 240, ROOM_WITHOUT_PANEL, POPOVER_MARGIN)).toBe(
        shipped(desired, 240, 1024),
      );
    }
  });

  it('lets the surface spill to the right when it is wider than the room', () => {
    // The owner decision of 2026-09-18, at the one state that reaches it: the
    // bar with an image selected is 372.66 px and the room at 600x400 with the
    // panel open is 372, so it cannot fit with a margin at each end — or with
    // no margin at all. The left bound wins, which puts the bar at the margin
    // from the window and 8.66 px over the card.
    const room = { left: 0, right: 372 };
    expect(withinRoom(50, 372.66, room, 8)).toBe(8);
    expect(withinRoom(-50, 372.66, room, 8)).toBe(8);
    // What that overhang is, stated as the number the manual pass looks for.
    expect(8 + 372.66 - room.right).toBeCloseTo(8.66, 2);
  });

  it('spills right rather than left because of the order of the two bounds', () => {
    // The pin for the reversal: swapping `Math.max` and `Math.min` gives the
    // other owner option — the surface pinned to the right edge and hanging off
    // the left of the window, where its first button cannot be pressed.
    const room = { left: 0, right: 372 };
    const swapped = Math.min(room.right - 372.66 - 8, Math.max(50, room.left + 8));
    expect(swapped).toBeCloseTo(-8.66, 2);
    expect(withinRoom(50, 372.66, room, 8)).toBe(8);
  });

  it('is never wrong-way-round about a room with a left edge away from zero', () => {
    // Nothing places the editor away from the window left today, and the flex
    // row makes it hard to. The row exists so that a future layout that does
    // cannot silently reintroduce a window-relative bound.
    const inset = { left: 100, right: 700 };
    expect(withinRoom(0, 240, inset, POPOVER_MARGIN)).toBe(108);
    expect(withinRoom(650, 240, inset, POPOVER_MARGIN)).toBe(452);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// editorRoom — the DOM read
// ─────────────────────────────────────────────────────────────────────────────

/** A rectangle stub, chosen by the first selector that matches the element. */
type Boxes = ReadonlyArray<readonly [selector: string, left: number, right: number]>;

const ZERO = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };

function stubRects(boxes: Boxes): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    for (const [selector, left, right] of boxes) {
      if (this.matches(selector)) {
        return {
          ...ZERO,
          left,
          right,
          x: left,
          width: right - left,
          height: 32,
          bottom: 32,
        } as DOMRect;
      }
    }
    return { ...ZERO, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

describe('editorRoom reads the editor rather than the window', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
    document.body.innerHTML = '';
  });

  it('answers the edges of the editor stack when the markup holds one', () => {
    document.body.innerHTML = '<div id="editor-stack"></div>';
    restore = stubRects([['#editor-stack', 0, 796]]);
    expect(editorRoom()).toEqual({ left: 0, right: 796 });
  });

  it('answers the window when the markup holds no editor stack', () => {
    // The pre-#350 behaviour rather than a guard against it, which is the shape
    // the header-bottom read uses one module over.
    document.body.innerHTML = '';
    expect(editorRoom()).toEqual({ left: 0, right: window.innerWidth });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The four callers — which bound each one read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The window, and a room narrower than it. On a real screen these are the same
 * number whenever the panel is closed, so they are made to differ here: that is
 * the whole of what makes the caller read visible.
 */
const WINDOW_WIDTH = 1024;
const ROOM_RIGHT = 796;

/** Where a caller would put a surface of `width` if it read the window instead. */
function ifItReadTheWindow(width: number): number {
  return WINDOW_WIDTH - width - POPOVER_MARGIN;
}

/** Where it lands reading the room. */
function readingTheRoom(width: number): number {
  return ROOM_RIGHT - width - POPOVER_MARGIN;
}

describe('every surface that hangs over the document is placed inside the room', () => {
  let restore: (() => void) | null = null;
  let instance: EditorInstance | null = null;
  let widthStub: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    (window as unknown as { innerWidth: number }).innerWidth = WINDOW_WIDTH;
    document.body.innerHTML = '<header id="menubar"></header><div id="editor-stack"></div>';
  });

  afterEach(() => {
    closeHeadingLevels();
    closeLanguagePopover();
    activeEmojiPalette()?.close();
    instance?.destroy();
    instance = null;
    restore?.();
    restore = null;
    if (widthStub) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthStub);
      widthStub = undefined;
    }
    document.body.innerHTML = '';
  });

  it('places the heading list against the room, not against the window', () => {
    const LIST_WIDTH = 240;
    restore = stubRects([
      ['#editor-stack', 0, ROOM_RIGHT],
      ['.heading-levels', 0, LIST_WIDTH],
      // The control the list hangs off, far enough right that the bound binds.
      ['#fake-anchor', 700, 760],
      ['#fake-toolbar', 700, 760],
    ]);
    const anchor = document.createElement('button');
    anchor.id = 'fake-anchor';
    const toolbar = document.createElement('div');
    toolbar.id = 'fake-toolbar';
    document.body.append(anchor, toolbar);

    const list = openHeadingLevels({ anchor, toolbar, current: null, onChoose: vi.fn() });

    expect(list.element.style.left).toBe(`${readingTheRoom(LIST_WIDTH)}px`);
    expect(list.element.style.left).not.toBe(`${ifItReadTheWindow(LIST_WIDTH)}px`);
  });

  it('places the language popover against the room, not against the window', () => {
    const POPOVER_WIDTH = 260;
    widthStub = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('language-popover') ? POPOVER_WIDTH : 0;
      },
    });
    restore = stubRects([
      ['#editor-stack', 0, ROOM_RIGHT],
      ['#fake-label', 700, 760],
    ]);
    const label = document.createElement('span');
    label.id = 'fake-label';
    document.body.appendChild(label);

    const popover = openLanguagePopover({
      anchor: label,
      initial: 'python',
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(popover.element.style.left).toBe(`${readingTheRoom(POPOVER_WIDTH)}px`);
    expect(popover.element.style.left).not.toBe(`${ifItReadTheWindow(POPOVER_WIDTH)}px`);
  });

  it('places the emoji palette against the room, not against the window', () => {
    // The surface this repair matters most to, measured: whenever the caret sat
    // right of the old bound, the palette landed on `innerWidth - width - 8`,
    // which put its right edge on the right edge of the panel card and covered
    // the card end to end - 220 px of a card 220 px wide, at every size.
    const PALETTE_WIDTH = 320;
    restore = stubRects([
      ['#editor-stack', 0, ROOM_RIGHT],
      ['.emoji-palette', 0, PALETTE_WIDTH],
    ]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    instance = editor;
    editor.setMarkdown('alpha beta gamma');
    editor.editor.view.coordsAtPos = () =>
      ({ left: 700, right: 706, top: 0, bottom: 0 }) as ReturnType<
        typeof editor.editor.view.coordsAtPos
      >;

    const palette = openEmojiPalette(editor.editor);

    expect(palette.element.style.left).toBe(`${readingTheRoom(PALETTE_WIDTH)}px`);
    expect(palette.element.style.left).not.toBe(`${ifItReadTheWindow(PALETTE_WIDTH)}px`);
  });

  it('places the floating toolbar against the room, not against the window', () => {
    const BAR_WIDTH = 338.66;
    restore = stubRects([
      ['#editor-stack', 0, ROOM_RIGHT],
      ['#floating-toolbar', 0, BAR_WIDTH],
    ]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    instance = editor;
    editor.setMarkdown('alpha beta gamma');
    setupToolbar(editor.editor, { onLink: vi.fn(), onImageDescription: vi.fn() });
    // The selection coordinates, supplied rather than measured: `coordsAtPos`
    // answers zero here, as every box does, and a bar centred on zero lands on
    // the left margin whichever bound it read. The number below puts it in the
    // half of the window the two bounds disagree about.
    editor.editor.view.coordsAtPos = () =>
      ({ left: 700, right: 720, top: 0, bottom: 0 }) as ReturnType<
        typeof editor.editor.view.coordsAtPos
      >;
    editor.editor.commands.setTextSelection({ from: 1, to: 6 });

    const bar = document.getElementById('floating-toolbar') as HTMLElement;
    expect(bar.style.left).toBe(`${readingTheRoom(BAR_WIDTH)}px`);
    expect(bar.style.left).not.toBe(`${ifItReadTheWindow(BAR_WIDTH)}px`);
  });
});
