/**
 * The emoji palette behind Insert Emoji (#296).
 *
 * Every test opens it the way a person does, from the entry the shipped
 * `index.html` renders, through the real `setupMenu`, into
 * `emojiMenuCallbacks`, the object `main.ts` spreads, and asserts what the
 * document, the focus or the palette became.
 *
 * **What `localStorage` holds decides the first emoji**, because the frequent
 * row comes first and takes focus. So every test starts from a cleared store,
 * and a test that needs a frequent row writes it itself, either as stored
 * counts or by choosing emoji through the palette. None of them passes because
 * of what an earlier test left behind.
 *
 * **What the harness cannot see is layout**: every rectangle is zero here. The
 * caret position is supplied where placement is the question, and where the
 * palette lands on screen is verified in Chromium and in the manual pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { EMOJI } from './emoji-list';
import {
  activeEmojiPalette,
  arrowTarget,
  EMOJI_OPTION_CLASS,
  emojiMenuCallbacks,
  FREQUENT_LABEL,
} from './emoji-palette';
import { type MenuCallbacks, setupMenu } from './menu';

const STORE_KEY = 'agented:emoji-frequent';

function spies(): MenuCallbacks {
  return {
    onNew: vi.fn(),
    onNewFromTemplate: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onClose: vi.fn(),
    onFind: vi.fn(),
    onReplace: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSelectAll: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertChecklist: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onInsertMetadata: vi.fn(),
    onInsertEmoji: vi.fn(),
    onToggleSidebar: vi.fn(),
    onAbout: vi.fn(),
  };
}

/** The shipped `<header>` alone: mounting the whole page would fetch assets. */
function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

let instance: EditorInstance | null = null;

beforeEach(() => {
  document.body.innerHTML = shippedHeaderMarkup();
  localStorage.clear();
});

afterEach(() => {
  activeEmojiPalette()?.close();
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

/** `markdown` loaded, the caret at `caret`, and the real menu bound over it. */
function openWithMenu(markdown: string, caret: number): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  instance.editor.commands.setTextSelection(caret);
  setupMenu({ ...spies(), ...emojiMenuCallbacks(instance.editor) }, () => ({
    canUndo: false,
    canRedo: false,
  }));
  return instance;
}

/** The toggle, the Insert section, then Insert Emoji, as a person clicks them. */
function chooseInsertEmoji(): HTMLElement {
  document.getElementById('menu-toggle')!.click();
  document.getElementById('menu-section-insert')!.click();
  document.getElementById('menu-insert-emoji')!.click();
  const palette = activeEmojiPalette();
  if (palette === null) throw new Error('Insert Emoji opened no palette');
  return palette.element;
}

function options(palette: HTMLElement): HTMLButtonElement[] {
  return Array.from(palette.querySelectorAll<HTMLButtonElement>(`.${EMOJI_OPTION_CLASS}`));
}

function groups(palette: HTMLElement): HTMLButtonElement[][] {
  return Array.from(palette.querySelectorAll('[role="group"]'), (group) =>
    Array.from(group.querySelectorAll<HTMLButtonElement>(`.${EMOJI_OPTION_CLASS}`)),
  );
}

function press(key: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Text typed at the caret, as its own transaction. */
function type(editor: EditorInstance, text: string): void {
  const { view } = editor.editor;
  view.dispatch(view.state.tr.insertText(text));
}

function stored(counts: Record<string, number>): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(counts));
}

describe('Insert Emoji opens the palette', () => {
  it('shows all 200 and no frequent row while nothing was ever chosen, with focus on the first', () => {
    expect(localStorage.getItem(STORE_KEY)).toBeNull();
    openWithMenu('one two', 4);

    const palette = chooseInsertEmoji();

    expect(options(palette).map((b) => b.textContent)).toEqual(EMOJI.map(([char]) => char));
    expect(palette.textContent).not.toContain(FREQUENT_LABEL);
    expect(document.activeElement).toBe(options(palette)[0]);
    expect(document.activeElement?.textContent).toBe(EMOJI[0][0]);
  });

  it('gives every emoji its name as a tooltip and as the name a screen reader reads', () => {
    openWithMenu('one two', 4);

    const palette = chooseInsertEmoji();

    expect(options(palette).map((b) => [b.title, b.getAttribute('aria-label')])).toEqual(
      EMOJI.map(([, name]) => [name, name]),
    );
  });

  it('leaves one tab stop in the palette, on the emoji that has focus', () => {
    openWithMenu('one two', 4);

    const palette = chooseInsertEmoji();
    press('ArrowRight');

    const stops = options(palette).filter((b) => b.tabIndex === 0);
    expect(stops).toEqual([document.activeElement]);
  });
});

describe('the frequent row', () => {
  it('comes first, under its label, most used first, and takes focus', () => {
    stored({ '🎉': 3, '✅': 5 });
    openWithMenu('one two', 4);

    const palette = chooseInsertEmoji();

    const [row, all] = groups(palette);
    expect(palette.textContent).toContain(FREQUENT_LABEL);
    expect(row.map((b) => b.textContent)).toEqual(['✅', '🎉']);
    expect(document.activeElement).toBe(row[0]);
    // By owner decision on #309: an emoji in the row is in the grid too.
    expect(all).toHaveLength(200);
  });

  it('orders by how often each was chosen, not by which was chosen last', () => {
    // Chosen through the palette, so the store is what choosing writes: three
    // times the third emoji, then once the first. By recency the first would
    // lead; by count the third does.
    openWithMenu('one two', 4);
    for (let i = 0; i < 3; i++) {
      const palette = chooseInsertEmoji();
      groups(palette).at(-1)![2].click();
    }
    const palette = chooseInsertEmoji();
    groups(palette).at(-1)![0].click();

    const reopened = chooseInsertEmoji();

    expect(groups(reopened)[0].map((b) => b.textContent)).toEqual([EMOJI[2][0], EMOJI[0][0]]);
  });

  it('holds eight at most', () => {
    stored(Object.fromEntries(EMOJI.slice(0, 12).map(([char], i) => [char, 20 - i])));
    openWithMenu('one two', 4);

    const palette = chooseInsertEmoji();

    expect(groups(palette)[0].map((b) => b.textContent)).toEqual(
      EMOJI.slice(0, 8).map(([char]) => char),
    );
  });
});

describe('choosing an emoji', () => {
  it('puts it at the caret, shuts the palette and gives focus back to the document', async () => {
    const editor = openWithMenu('one two', 4);

    options(chooseInsertEmoji())[0].click();

    expect(editor.getMarkdown()).toBe(`one${EMOJI[0][0]} two`);
    expect(activeEmojiPalette()).toBeNull();
    await nextFrame();
    expect(editor.editor.view.dom.contains(document.activeElement)).toBe(true);
  });

  it('replaces a selection', () => {
    const editor = openWithMenu('one two', 1);
    editor.editor.commands.setTextSelection({ from: 1, to: 4 });

    options(chooseInsertEmoji())[0].click();

    expect(editor.getMarkdown()).toBe(`${EMOJI[0][0]} two`);
  });

  it('is one step of undo, apart from a word typed just before it and one typed just after', () => {
    const editor = openWithMenu('one two', 4);
    type(editor, 'x');
    options(chooseInsertEmoji())[0].click();
    type(editor, 'y');
    expect(editor.getMarkdown()).toBe(`onex${EMOJI[0][0]}y two`);

    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe(`onex${EMOJI[0][0]} two`);
    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe('onex two');
  });
});

describe('the keyboard', () => {
  it('shuts the palette on Escape and gives focus back at the caret it had', async () => {
    const editor = openWithMenu('one two', 4);
    chooseInsertEmoji();

    press('Escape');

    expect(activeEmojiPalette()).toBeNull();
    expect(editor.getMarkdown()).toBe('one two');
    // Typed before the focus lands, on purpose. In this harness a character
    // typed after focus returns lands at the start of the document; in
    // Chromium it was measured landing at the caret, on the #296 step zero and
    // again on this branch. Why the harness differs was not traced. What this
    // asserts is that Escape leaves the caret where it was; that the caret
    // survives focus coming back is verified in a browser, not here.
    type(editor, 'X');
    expect(editor.getMarkdown()).toBe('oneX two');
    await nextFrame();
    expect(editor.editor.view.dom.contains(document.activeElement)).toBe(true);
  });

  it('walks the grid with the arrow keys', () => {
    openWithMenu('one two', 4);
    const palette = chooseInsertEmoji();
    const all = options(palette);

    press('ArrowRight');
    expect(document.activeElement).toBe(all[1]);
    press('ArrowDown');
    expect(document.activeElement).toBe(all[9]);
    press('ArrowLeft');
    expect(document.activeElement).toBe(all[8]);
    press('ArrowUp');
    expect(document.activeElement).toBe(all[0]);
    press('End');
    expect(document.activeElement).toBe(all[199]);
    press('Home');
    expect(document.activeElement).toBe(all[0]);
  });

  it('crosses between the frequent row and the grid, keeping the column', () => {
    expect(arrowTarget([3, 200], [0, 2], 'ArrowDown')).toEqual([1, 2]);
    expect(arrowTarget([3, 200], [1, 5], 'ArrowUp')).toEqual([0, 2]);
    expect(arrowTarget([3, 200], [0, 2], 'ArrowRight')).toEqual([1, 0]);
    expect(arrowTarget([3, 200], [1, 0], 'ArrowLeft')).toEqual([0, 2]);
    expect(arrowTarget([203], [0, 195], 'ArrowDown')).toEqual([0, 202]);
    expect(arrowTarget([200], [0, 196], 'ArrowDown')).toEqual([0, 196]);
    expect(arrowTarget([200], [0, 199], 'ArrowDown')).toEqual([0, 199]);
    expect(arrowTarget([200], [0, 3], 'ArrowUp')).toEqual([0, 3]);
  });
});

describe('where it opens', () => {
  it('brings the caret into view before it reads where the caret is', () => {
    const editor = openWithMenu('one two', 4);
    const order: string[] = [];
    editor.editor.on('transaction', ({ transaction }) => {
      if (transaction.scrolledIntoView) order.push('scrolled');
    });
    vi.spyOn(editor.editor.view, 'coordsAtPos').mockImplementation(() => {
      order.push('read');
      return { left: 100, right: 101, top: 200, bottom: 220 };
    });

    chooseInsertEmoji();

    expect(order.slice(0, 2)).toEqual(['scrolled', 'read']);
  });

  it('stays inside the window for a caret the window does not show', () => {
    // The caret positions the step zero measured: -2380 and +1908 px.
    for (const top of [-2380, 1908]) {
      const editor = openWithMenu('one two', 4);
      vi.spyOn(editor.editor.view, 'coordsAtPos').mockReturnValue({
        left: 100,
        right: 101,
        top,
        bottom: top + 20,
      });
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(964);

      const palette = chooseInsertEmoji();

      const placedTop = Number.parseFloat(palette.style.top);
      const maxHeight = Number.parseFloat(palette.style.maxHeight);
      expect(placedTop, `caret at ${top}`).toBeGreaterThanOrEqual(0);
      expect(placedTop + maxHeight, `caret at ${top}`).toBeLessThanOrEqual(window.innerHeight);
      expect(maxHeight, `caret at ${top}`).toBeGreaterThan(0);

      activeEmojiPalette()?.close();
      instance?.destroy();
      vi.restoreAllMocks();
      document.body.innerHTML = shippedHeaderMarkup();
    }
  });
});

describe('the click outside', () => {
  it('shuts the palette, and a click inside it does not', () => {
    openWithMenu('one two', 4);
    const palette = chooseInsertEmoji();

    palette.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(activeEmojiPalette()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(activeEmojiPalette()).toBeNull();
  });
});
