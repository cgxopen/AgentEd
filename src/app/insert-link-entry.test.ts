import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { type LinkDialog, setupLinkDialog } from './link-dialog';

/**
 * Insert, Link (#450): the door the link dialog had at a bare caret.
 *
 * The dialog was built for three situations - text selected, the caret inside
 * a link, nothing selected - and opened from the floating toolbar and Ctrl+K.
 * The toolbar hides at a bare caret, so with the caret inside a link, or with
 * nothing selected, the chord was the only way in. These drive the shipped menu
 * and the shipped dialog over a real editor, with the entry wired to the same
 * `open` the toolbar and the chord call, as `main.ts` wires it.
 */

function shipped(open: string, close: string): string {
  const start = shippedPage.indexOf(open);
  const end = shippedPage.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`index.html no longer ships ${open}`);
  return shippedPage.slice(start, end + close.length);
}

let instance: EditorInstance | null = null;
let dialog: LinkDialog;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  dialog = setupLinkDialog(instance.editor);
  const callbacks = new Proxy({} as MenuCallbacks, {
    get: (_target, name) => (name === 'onInsertLink' ? () => dialog.open() : vi.fn()),
  });
  setupMenu(
    callbacks,
    () => ({ canUndo: true, canRedo: true }),
    () => new Proxy({}, { get: () => true }),
  );
  return instance;
}

/** The Insert entry that opens the link dialog, or null where there is none. */
function linkEntry(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('#menu-panel-insert #menu-insert-link');
}

function chooseLink(): void {
  (document.getElementById('menu-toggle') as HTMLElement).click();
  (document.getElementById('menu-section-insert') as HTMLElement).click();
  const entry = linkEntry();
  expect(entry, 'the Insert menu has a Link entry').not.toBeNull();
  entry?.click();
}

const overlay = () => document.getElementById('link-dialog') as HTMLElement;
const field = () => document.getElementById('link-url') as HTMLInputElement;
const remove = () => document.getElementById('link-remove') as HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML =
    shipped('<header id="menubar">', '</header>') +
    shipped('<div id="link-dialog"', '\n    </div>');
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('Insert, Link (#450)', () => {
  it('with nothing selected, opens the dialog, and the address becomes its own text', () => {
    const editor = editorWith('plain words');
    editor.editor.commands.setTextSelection(6);
    chooseLink();
    expect(overlay().classList.contains('hidden')).toBe(false);
    expect(remove().classList.contains('hidden')).toBe(true);
    field().value = 'https://example.com';
    (document.getElementById('link-confirm') as HTMLButtonElement).click();
    expect(editor.getMarkdown()).toBe('plain[https://example.com](https://example.com) words');
  });

  it('with the caret inside a link, opens the dialog filled in, and Remove unmakes it', () => {
    const editor = editorWith('read [the docs](https://example.com) now');
    let inside = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (inside < 0 && node.isText && node.text === 'the docs') inside = pos + 2;
    });
    editor.editor.commands.setTextSelection(inside);
    chooseLink();
    expect(overlay().classList.contains('hidden')).toBe(false);
    expect(field().value).toBe('https://example.com');
    expect(remove().classList.contains('hidden')).toBe(false);
    remove().click();
    expect(editor.getMarkdown()).toBe('read the docs now');
  });
});
