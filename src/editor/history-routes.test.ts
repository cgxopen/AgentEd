/**
 * Undo and Redo in the Edit section (#295).
 *
 * Every row clicks the **real rendered entry** out of the shipped page, reached
 * the way a person reaches it, through the real `setupMenu`, into
 * `historyMenuCallbacks` and `historyAvailability` — the two objects `main.ts`
 * hands the menu — and asserts **what the document became**, or whether the
 * entry was greyed. Which handler each entry calls is pinned by the table in
 * `menu.test.ts`; what is pinned here is that the command does the thing.
 *
 * Nothing here is layout. What the harness cannot see is how a greyed entry
 * looks, and the context menu the runtime draws over the editor, which is not
 * the page at all; both belong to the manual pass.
 */
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { historyAvailability, historyMenuCallbacks } from './history-routes';
import { createEditor, type EditorInstance } from './setup';

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
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/** An editor loaded with `markdown`, with the real menu bound over it as `main.ts` binds it. */
function openWithMenu(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  const { editor } = instance;
  setupMenu({ ...spies(), ...historyMenuCallbacks(editor) }, () => historyAvailability(editor));
  return instance;
}

/** An edit the history records as a step of its own, typed at the end of the document. */
function typeAtEnd(editor: EditorInstance, text: string): void {
  const { editor: tiptap } = editor;
  tiptap.view.dispatch(closeHistory(tiptap.state.tr));
  tiptap.chain().focus('end').insertContent(text).run();
}

function entry(id: 'menu-undo' | 'menu-redo'): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

/** Opens the menu and its Edit section, by clicking what a person clicks. */
function openEdit(): void {
  document.getElementById('menu-toggle')!.click();
  document.getElementById('menu-section-edit')!.click();
}

/** Closes the menu the way a click elsewhere does. */
function closeMenu(): void {
  document.body.click();
}

function choose(id: 'menu-undo' | 'menu-redo'): void {
  openEdit();
  entry(id).click();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Whether each entry is greyed, as the menu shows it once opened. */
function greyed(): { undo: boolean; redo: boolean } {
  openEdit();
  const state = { undo: entry('menu-undo').disabled, redo: entry('menu-redo').disabled };
  closeMenu();
  return state;
}

describe('the Undo and Redo entries do what they are named for', () => {
  it('takes the last edit back with Undo, and puts it back with Redo', () => {
    const editor = openWithMenu('one');
    typeAtEnd(editor, ' two');
    expect(editor.getMarkdown()).toBe('one two');

    choose('menu-undo');
    expect(editor.getMarkdown()).toBe('one');

    choose('menu-redo');
    expect(editor.getMarkdown()).toBe('one two');
  });

  it('takes one step per press, newest first, and never past the document as it was loaded', () => {
    const editor = openWithMenu('one');
    typeAtEnd(editor, ' two');
    typeAtEnd(editor, ' three');

    choose('menu-undo');
    expect(editor.getMarkdown()).toBe('one two');
    choose('menu-undo');
    expect(editor.getMarkdown()).toBe('one');
    // R-C16: the load is not an edit, so there is nothing further back.
    choose('menu-undo');
    expect(editor.getMarkdown()).toBe('one');

    choose('menu-redo');
    expect(editor.getMarkdown()).toBe('one two');
  });

  it('gives focus back to the document, as the Insert entries do', async () => {
    const editor = openWithMenu('one');
    typeAtEnd(editor, ' two');
    // TipTap moves focus on the next animation frame rather than inside the
    // command, so the frame the edit above queued is spent before the entry is
    // chosen; otherwise it would put focus in the document whatever Undo did.
    await nextFrame();

    choose('menu-undo');
    expect(document.activeElement).toBe(document.getElementById('menu-toggle'));
    await nextFrame();

    expect(editor.editor.view.dom.contains(document.activeElement)).toBe(true);
  });
});

describe('Undo and Redo are greyed when there is nothing for them to do', () => {
  it('greys both over a document just loaded', () => {
    openWithMenu('one');

    expect(greyed()).toEqual({ undo: true, redo: true });
  });

  it('enables Undo after one edit, and Redo only once something was undone', () => {
    const editor = openWithMenu('one');

    typeAtEnd(editor, ' two');
    expect(greyed()).toEqual({ undo: false, redo: true });

    choose('menu-undo');
    expect(greyed()).toEqual({ undo: true, redo: false });

    choose('menu-redo');
    expect(greyed()).toEqual({ undo: false, redo: true });
  });

  it('reads the state again after a document load, rather than what it read before it', () => {
    // The case that decided when the state is read. A reading taken at the last
    // transaction was measured on #295 to count 3 steps after New over a history
    // holding 0, because the load forgets the history without a transaction.
    const editor = openWithMenu('one');
    typeAtEnd(editor, ' two');
    expect(greyed()).toEqual({ undo: false, redo: true });

    editor.setMarkdown('another document');

    expect(greyed()).toEqual({ undo: true, redo: true });
  });
});

describe('the chords are untouched by the entries', () => {
  function press(editor: EditorInstance, key: string): void {
    editor.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }),
    );
  }

  it('undoes with Ctrl+Z and redoes with Ctrl+Y from the body, with the menu bound', () => {
    const editor = openWithMenu('one');
    typeAtEnd(editor, ' two');

    press(editor, 'z');
    expect(editor.getMarkdown()).toBe('one');

    press(editor, 'y');
    expect(editor.getMarkdown()).toBe('one two');
  });
});
