/**
 * The emoji palette behind Insert Emoji (#296).
 *
 * ── Which popover this follows ──
 *
 * `heading-levels.ts` and `language-popover.ts`: built on demand, appended to
 * the body, one open at a time, a capture-phase mousedown for the click
 * outside, and placed in JavaScript through `popoverPlacement`. Appended to the
 * body is also why the page cannot scroll because of it: it hangs on no
 * containing block the way the menu cap of #294 does, and the stylesheet
 * positions it against the window.
 *
 * **It differs from both in taking focus**, as the #296 step zero built it. The
 * menu hands focus to its toggle as it closes, so there is no editor focus to
 * keep, and a grid of 200 is a keyboard surface: focus goes to the first emoji,
 * the arrow keys move through the grid, Enter chooses. Escape and a choice both
 * give focus back to the document at its caret.
 *
 * ── Where it opens ──
 *
 * Against the caret, which is brought into view first. The step zero measured
 * a caret scrolled out of the window: the palette was drawn wholly outside it,
 * with focus inside it, so a key press inserted an emoji nobody could see.
 * Bringing the caret into view answers that here, and the band in
 * `popoverPlacement` answers it for any caller.
 *
 * ── What it shows ──
 *
 * The frequent row first, when there is one: the eight emoji used most, under
 * their own label. Then all 200 of `EMOJI`. **An emoji in the frequent row
 * appears in the grid as well**, as the prototype had it; whether it should is
 * in front of the owner, and this is the shape built until he answers.
 */

import type { Editor } from '@tiptap/core';
import { insertEmoji } from '../editor/insert-emoji';
import { loadFrequentEmoji, recordEmojiUse } from '../preferences';
import { EMOJI } from './emoji-list';
import { POPOVER_MARGIN, popoverPlacement } from './popover-placement';

/** The class the stylesheet draws the palette with. */
export const EMOJI_PALETTE_CLASS = 'emoji-palette';

/** One emoji of it. */
export const EMOJI_OPTION_CLASS = 'emoji-palette-option';

/** The emoji per row, which the stylesheet repeats as its column count. */
export const EMOJI_COLUMNS = 8;

/** The words above the frequent row. */
export const FREQUENT_LABEL = 'Frequently used';

export interface EmojiPalette {
  readonly element: HTMLElement;
  readonly close: () => void;
}

let open: EmojiPalette | null = null;

/** Whatever is open now, or `null`. Read by the tests. */
export function activeEmojiPalette(): EmojiPalette | null {
  return open;
}

/** The emoji of the frequent row, most used first, with their names. */
export function frequentRow(): Array<readonly [char: string, name: string]> {
  const names = new Map(EMOJI);
  return loadFrequentEmoji()
    .slice(0, EMOJI_COLUMNS)
    .map(([char]) => [char, names.get(char) ?? ''] as const);
}

function button(char: string, name: string, onChoose: (char: string) => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = EMOJI_OPTION_CLASS;
  element.textContent = char;
  element.tabIndex = -1;
  if (name.length > 0) {
    element.title = name;
    element.setAttribute('aria-label', name);
  }
  element.addEventListener('click', () => onChoose(char));
  return element;
}

/** A labelled run of emoji, in rows of `EMOJI_COLUMNS`. */
function section(
  label: string,
  entries: ReadonlyArray<readonly [string, string]>,
  onChoose: (char: string) => void,
): { readonly group: HTMLElement; readonly buttons: HTMLButtonElement[] } {
  const group = document.createElement('div');
  group.className = 'emoji-palette-grid';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  const buttons = entries.map(([char, name]) => button(char, name, onChoose));
  group.append(...buttons);
  return { group, buttons };
}

/**
 * Where the arrow keys go from `index` in `sections`, which are rows of
 * `EMOJI_COLUMNS`. Left and right walk the emoji in order across both
 * sections; up and down keep the column, crossing into the other section at
 * its edge and stopping at the first and last rows.
 */
export function arrowTarget(
  sizes: readonly number[],
  position: readonly [section: number, index: number],
  key: string,
): readonly [number, number] {
  const [s, i] = position;
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const flat = sizes.slice(0, s).reduce((sum, n) => sum + n, 0) + i;
    const total = sizes.reduce((sum, n) => sum + n, 0);
    let next = Math.max(0, Math.min(total - 1, flat + (key === 'ArrowRight' ? 1 : -1)));
    for (let k = 0; k < sizes.length; k++) {
      if (next < sizes[k]) return [k, next];
      next -= sizes[k];
    }
    return [s, i];
  }
  if (key === 'Home') return [0, 0];
  if (key === 'End') return [sizes.length - 1, sizes[sizes.length - 1] - 1];
  const column = i % EMOJI_COLUMNS;
  if (key === 'ArrowDown') {
    if (i + EMOJI_COLUMNS < sizes[s]) return [s, i + EMOJI_COLUMNS];
    const nextRowStart = i - column + EMOJI_COLUMNS;
    if (nextRowStart < sizes[s]) return [s, sizes[s] - 1];
    return s + 1 < sizes.length ? [s + 1, Math.min(column, sizes[s + 1] - 1)] : [s, i];
  }
  if (key === 'ArrowUp') {
    if (i - EMOJI_COLUMNS >= 0) return [s, i - EMOJI_COLUMNS];
    if (s === 0) return [s, i];
    const above = sizes[s - 1];
    const lastRowStart = Math.floor((above - 1) / EMOJI_COLUMNS) * EMOJI_COLUMNS;
    return [s - 1, Math.min(lastRowStart + column, above - 1)];
  }
  return [s, i];
}

const ARROW_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Against the caret, kept inside the window. Measured before it is placed, as
 * `heading-levels.ts` does: the element is in the document, so its height is a
 * real box.
 */
function position(element: HTMLElement, editor: Editor): void {
  editor.commands.scrollIntoView();
  const caret = editor.view.coordsAtPos(editor.state.selection.head);
  const header = document.getElementById('menubar');
  // `#menubar` is written in `index.html`; without it the ceiling is the
  // window top, as in `heading-levels.ts`.
  const headerBottom = header === null ? 0 : header.getBoundingClientRect().bottom;
  const placement = popoverPlacement(
    caret.top,
    caret.bottom,
    element.scrollHeight,
    headerBottom,
    window.innerHeight,
  );
  const width = element.getBoundingClientRect().width;
  const left = Math.max(
    POPOVER_MARGIN,
    Math.min(caret.left, window.innerWidth - width - POPOVER_MARGIN),
  );
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(placement.top)}px`;
  element.style.maxHeight = `${Math.round(placement.maxHeight)}px`;
}

export function openEmojiPalette(editor: Editor): EmojiPalette {
  open?.close();

  const element = document.createElement('div');
  element.className = EMOJI_PALETTE_CLASS;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Insert emoji');

  function finish(): void {
    element.remove();
    document.removeEventListener('mousedown', onOutside, true);
    if (open?.element === element) open = null;
  }

  function choose(char: string): void {
    finish();
    recordEmojiUse(char);
    insertEmoji(editor, char);
  }

  const sections: Array<{ readonly buttons: HTMLButtonElement[] }> = [];
  const frequent = frequentRow();
  if (frequent.length > 0) {
    const label = document.createElement('div');
    label.className = 'emoji-palette-label';
    label.textContent = FREQUENT_LABEL;
    label.setAttribute('aria-hidden', 'true');
    const row = section(FREQUENT_LABEL, frequent, choose);
    element.append(label, row.group);
    sections.push(row);
  }
  const all = section('All emoji', EMOJI, choose);
  element.append(all.group);
  sections.push(all);

  /** Moves focus, and the one tab stop with it, so Tab leaves the palette in one press. */
  function focusAt([s, i]: readonly [number, number]): void {
    for (const each of sections) for (const b of each.buttons) b.tabIndex = -1;
    const target = sections[s].buttons[i];
    target.tabIndex = 0;
    target.focus();
  }

  function positionOf(target: EventTarget | null): readonly [number, number] | null {
    for (let s = 0; s < sections.length; s++) {
      const i = sections[s].buttons.indexOf(target as HTMLButtonElement);
      if (i >= 0) return [s, i];
    }
    return null;
  }

  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      editor.commands.focus();
      return;
    }
    if (!ARROW_KEYS.has(event.key)) return;
    const from = positionOf(event.target);
    if (from === null) return;
    event.preventDefault();
    focusAt(
      arrowTarget(
        sections.map((each) => each.buttons.length),
        from,
        event.key,
      ),
    );
  });

  function onOutside(event: MouseEvent): void {
    if (event.target instanceof Node && element.contains(event.target)) return;
    finish();
  }

  document.body.appendChild(element);
  position(element, editor);
  focusAt([0, 0]);
  // Captured, so a click anywhere else closes this before that click does
  // anything else, as in the two popovers this follows.
  document.addEventListener('mousedown', onOutside, true);

  open = { element, close: finish };
  return open;
}

export interface EmojiMenuCallbacks {
  readonly onInsertEmoji: () => void;
}

/** The menu mapping, as one object `main.ts` spreads, so the tests drive what it runs. */
export function emojiMenuCallbacks(editor: Editor): EmojiMenuCallbacks {
  return { onInsertEmoji: () => openEmojiPalette(editor) };
}
