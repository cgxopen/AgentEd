/**
 * ── What can be asserted here, and what cannot ──
 *
 * Where the list opens is `popoverPlacement`, which takes numbers and returns
 * numbers and is asserted in `popover-placement.test.ts`, with the list and
 * toolbar sizes measured in #267 as its arguments. Everything in this file is
 * DOM structure and keyboard behaviour, which happy-dom does answer.
 *
 * **What is not asserted anywhere is the placement itself.** That `position`
 * calls that function with the real toolbar rect, the real header bottom and
 * the real list height cannot be shown where every box measures 0 by 0; the
 * placement on screen is verified by hand on Windows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeHeadingLevels,
  closeHeadingLevels,
  HEADING_CHOICES,
  HEADING_LEVEL_OPTION_CLASS,
  HEADING_LEVELS_CLASS,
  openHeadingLevels,
} from './heading-levels';
import { POPOVER_OFFSET } from './popover-placement';

describe('the list the toolbar offers (#267)', () => {
  it('holds every level CommonMark spells, and the way back to body text', () => {
    expect(HEADING_CHOICES.map((c) => c.level)).toEqual([1, 2, 3, 4, 5, 6, null]);
  });

  it('reads as words rather than as tags', () => {
    // "Metadata, not Frontmatter" — the wording rule in CLAUDE.md.
    expect(HEADING_CHOICES.map((c) => c.label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Heading 5',
      'Heading 6',
      'Body text',
    ]);
  });
});

describe('the list, driven (#267)', () => {
  function anchorAndToolbar(): { anchor: HTMLElement; toolbar: HTMLElement } {
    const toolbar = document.createElement('div');
    const anchor = document.createElement('button');
    toolbar.appendChild(anchor);
    document.body.appendChild(toolbar);
    return { anchor, toolbar };
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.${HEADING_LEVEL_OPTION_CLASS}`),
    );
  }

  it('marks the level the caret is already in', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    openHeadingLevels({ anchor, toolbar, current: 4, onChoose: () => {} });

    const marked = rows().filter((r) => r.getAttribute('aria-current') === 'true');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe('Heading 4');
    closeHeadingLevels();
  });

  it('a second open leaves no first one behind', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: () => {} });
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: () => {} });
    expect(rows()).toHaveLength(HEADING_CHOICES.length);
    closeHeadingLevels();
  });

  it('the arrow keys move the highlight and Enter takes the one they are on', () => {
    // Opened at the top of the list, then walked down twice: the choice that
    // comes back is the third, which no initial state produces on its own.
    const { anchor, toolbar } = anchorAndToolbar();
    const chosen: string[] = [];
    openHeadingLevels({
      anchor,
      toolbar,
      current: 1,
      onChoose: (c) => chosen.push(c.label),
    });

    for (const key of ['ArrowDown', 'ArrowDown']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(chosen).toEqual(['Heading 3']);
    expect(activeHeadingLevels()).toBeNull();
  });

  it('Escape closes it and chooses nothing', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    const chosen: string[] = [];
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: (c) => chosen.push(c.label) });
    expect(activeHeadingLevels()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(activeHeadingLevels()).toBeNull();
    expect(rows()).toHaveLength(0);
    expect(chosen).toEqual([]);
  });

  it('a press outside closes it and chooses nothing', () => {
    const { anchor, toolbar } = anchorAndToolbar();
    const chosen: string[] = [];
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: (c) => chosen.push(c.label) });

    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(activeHeadingLevels()).toBeNull();
    expect(chosen).toEqual([]);
  });
});

/**
 * The list is placed through `popoverPlacement` (#272).
 *
 * Measured when that function moved out of this file: pointing this list at
 * the language popover placement instead, which holds a popover by its bottom
 * edge and sets no height, left all 3046 tests green. Nothing watched this
 * caller at all. So the list is opened here with rectangles supplied to it:
 * a toolbar, a header, and a list of the height measured in #267.
 */
describe('the list is placed through the shared arithmetic (#272)', () => {
  const LIST_H = 203;
  const TOOLBAR_H = 31.59;
  let toolbarTop = 0;
  const innerHeight = window.innerHeight;

  afterEach(() => {
    closeHeadingLevels();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    document.body.innerHTML = '';
  });

  function openWithToolbarAt(top: number): HTMLElement {
    toolbarTop = top;
    document.body.innerHTML = '<header id="menubar"></header>';
    const toolbar = document.createElement('div');
    const anchor = document.createElement('button');
    toolbar.appendChild(anchor);
    document.body.appendChild(toolbar);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const box = (y: number, height: number) =>
        ({ top: y, bottom: y + height, left: 20, right: 260, width: 240, height }) as DOMRect;
      if (this === toolbar) return box(toolbarTop, TOOLBAR_H);
      if (this.id === 'menubar') return box(0, 44);
      if (this.classList.contains(HEADING_LEVELS_CLASS)) return box(0, LIST_H);
      return box(0, 0);
    });
    openHeadingLevels({ anchor, toolbar, current: null, onChoose: () => {} });
    const list = document.querySelector<HTMLElement>(`.${HEADING_LEVELS_CLASS}`);
    if (list === null) throw new Error('openHeadingLevels rendered no list');
    return list;
  }

  it('opens under a toolbar with room below, by its top, with its own height', () => {
    const list = openWithToolbarAt(300);
    expect(list.style.top).toBe(`${Math.round(300 + TOOLBAR_H + POPOVER_OFFSET)}px`);
    expect(list.style.maxHeight).toBe(`${LIST_H}px`);
    expect(list.style.bottom).toBe('');
  });

  it('opens over a toolbar low in the window, by its top, with its own height', () => {
    const list = openWithToolbarAt(700);
    expect(list.style.top).toBe(`${Math.round(700 - POPOVER_OFFSET - LIST_H)}px`);
    expect(list.style.maxHeight).toBe(`${LIST_H}px`);
  });
});
