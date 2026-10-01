import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { INSERT_LINK_KEY, type LinkDialog, linkAvailability, setupLinkDialog } from './link-dialog';

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
    () =>
      new Proxy(linkAvailability((instance as EditorInstance).editor), {
        get: (reading, key) => (key === INSERT_LINK_KEY ? Reflect.get(reading, key) : true),
      }),
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

/**
 * Where the entry is greyed (#450 step zero, the rule of #292). Each place was
 * measured by confirming the dialog there before the entry existed: in a
 * fenced block the address went in as code text or nothing changed, and on a
 * selected rule nothing changed. A selected image, an inline code span and
 * the whole document each took a link, so the entry stays offered there.
 */
describe('Insert, Link is greyed where the dialog cannot make a link (#450)', () => {
  function position(editor: EditorInstance, type: string): number {
    let found = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.name === type) found = pos;
    });
    return found;
  }

  function greyedAfter(markdown: string, place: (editor: EditorInstance) => void): boolean {
    const editor = editorWith(markdown);
    place(editor);
    (document.getElementById('menu-toggle') as HTMLElement).click();
    return (linkEntry() as HTMLButtonElement).disabled;
  }

  const fence = 'before\n\n```\ncode here\n```\n\nafter';

  it.each([
    [
      'the caret in a fenced block',
      true,
      fence,
      (e: EditorInstance) => {
        const p = position(e, 'codeBlock');
        e.editor.view.dispatch(
          e.editor.state.tr.setSelection(TextSelection.create(e.editor.state.doc, p + 3)),
        );
      },
    ],
    [
      'text selected in a fenced block',
      true,
      fence,
      (e: EditorInstance) => {
        const p = position(e, 'codeBlock');
        e.editor.view.dispatch(
          e.editor.state.tr.setSelection(TextSelection.create(e.editor.state.doc, p + 1, p + 5)),
        );
      },
    ],
    [
      'a selected horizontal rule',
      true,
      'a\n\n---\n\nb',
      (e: EditorInstance) => {
        const p = position(e, 'horizontalRule');
        e.editor.view.dispatch(
          e.editor.state.tr.setSelection(NodeSelection.create(e.editor.state.doc, p)),
        );
      },
    ],
    [
      'a selected image',
      false,
      'a ![alt](i.png) b',
      (e: EditorInstance) => {
        const p = position(e, 'image');
        e.editor.view.dispatch(
          e.editor.state.tr.setSelection(NodeSelection.create(e.editor.state.doc, p)),
        );
      },
    ],
    [
      'the caret in inline code',
      false,
      'a `code here` b',
      (e: EditorInstance) => e.editor.commands.setTextSelection(6),
    ],
    [
      'the whole document',
      false,
      '# Title\n\npara',
      (e: EditorInstance) =>
        e.editor.view.dispatch(
          e.editor.state.tr.setSelection(new AllSelection(e.editor.state.doc)),
        ),
    ],
    [
      'the caret in a paragraph',
      false,
      'plain words',
      (e: EditorInstance) => e.editor.commands.setTextSelection(3),
    ],
  ])('%s: greyed %s', (_label, greyed, markdown, place) => {
    expect(greyedAfter(markdown, place)).toBe(greyed);
  });
});
