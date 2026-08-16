import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The shipped markup, so a field renamed in index.html fails here rather than
// at the user's first Ctrl+K.
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { type LinkDialog, setupLinkDialog } from './link-dialog';

function shippedFragment(id: string): string {
  const open = shippedPage.indexOf(`<div id="${id}"`);
  if (open < 0) throw new Error(`index.html no longer ships #${id}`);
  const close = shippedPage.indexOf('\n    </div>', open);
  if (close < 0) throw new Error(`could not find the end of #${id}`);
  return shippedPage.slice(open, close + '\n    </div>'.length);
}

let instance: EditorInstance | null = null;
let dialog: LinkDialog;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  dialog = setupLinkDialog(instance.editor);
  return instance;
}

/** Select the given text inside the document. */
function select(editorInstance: EditorInstance, text: string): void {
  let from = -1;
  editorInstance.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) {
      from = pos + node.text.indexOf(text);
    }
  });
  if (from < 0) throw new Error(`text not found: ${text}`);
  editorInstance.editor.commands.setTextSelection({ from, to: from + text.length });
}

/** Put the caret inside the given text. */
function caretIn(editorInstance: EditorInstance, text: string): void {
  select(editorInstance, text);
  const { from } = editorInstance.editor.state.selection;
  editorInstance.editor.commands.setTextSelection(from + 1);
}

const overlay = () => document.getElementById('link-dialog') as HTMLElement;
const input = () => document.getElementById('link-url') as HTMLInputElement;
const remove = () => document.getElementById('link-remove') as HTMLButtonElement;
const confirm = () => document.getElementById('link-confirm') as HTMLButtonElement;

function type(url: string): void {
  input().value = url;
}

function pressEnter(): void {
  overlay().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = shippedFragment('link-dialog');
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('link dialog — with a selection', () => {
  it('makes the selection the link text', () => {
    const editor = editorWith('read the docs now');
    select(editor, 'the docs');
    dialog.open();
    type('https://example.com');
    confirm().click();

    expect(editor.getMarkdown()).toBe('read [the docs](https://example.com) now');
  });

  it('round-trips the link it created, byte for byte (R-C2)', () => {
    const editor = editorWith('read the docs now');
    select(editor, 'the docs');
    dialog.open();
    type('https://example.com');
    confirm().click();

    const markdown = editor.getMarkdown();
    editor.setMarkdown(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it('gives a bare host the implied scheme', () => {
    const editor = editorWith('docs');
    select(editor, 'docs');
    dialog.open();
    type('example.com');
    pressEnter();

    expect(editor.getMarkdown()).toBe('[docs](https://example.com)');
  });
});

describe('link dialog — on an existing link', () => {
  it('opens pre-filled with the current address', () => {
    const editor = editorWith('[docs](https://example.com)');
    caretIn(editor, 'docs');
    dialog.open();

    expect(input().value).toBe('https://example.com');
    expect(remove().classList.contains('hidden')).toBe(false);
  });

  it('changes the address of the whole link from a caret inside it', () => {
    const editor = editorWith('[docs](https://old.example)');
    caretIn(editor, 'docs');
    dialog.open();
    type('https://new.example');
    confirm().click();

    expect(editor.getMarkdown()).toBe('[docs](https://new.example)');
  });

  it('unmakes the link from the Remove button, keeping the text', () => {
    const editor = editorWith('[docs](https://example.com)');
    caretIn(editor, 'docs');
    dialog.open();
    remove().click();

    expect(editor.getMarkdown()).toBe('docs');
  });

  it('treats an emptied address as Remove', () => {
    const editor = editorWith('[docs](https://example.com)');
    caretIn(editor, 'docs');
    dialog.open();
    type('');
    confirm().click();

    expect(editor.getMarkdown()).toBe('docs');
  });

  it('offers no Remove when there is no link to unmake', () => {
    const editor = editorWith('plain text');
    select(editor, 'plain');
    dialog.open();

    expect(remove().classList.contains('hidden')).toBe(true);
  });
});

describe('link dialog — with no selection', () => {
  it('inserts a link whose visible text is the address', () => {
    const editor = editorWith('');
    dialog.open();
    type('https://example.com');
    confirm().click();

    expect(editor.getMarkdown()).toBe('[https://example.com](https://example.com)');
  });
});

describe('link dialog — refusals and cancelling', () => {
  it('changes nothing on Escape', () => {
    const editor = editorWith('read the docs now');
    select(editor, 'the docs');
    dialog.open();
    type('https://example.com');
    overlay().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(editor.getMarkdown()).toBe('read the docs now');
    expect(overlay().classList.contains('hidden')).toBe(true);
  });

  it('changes nothing on Cancel', () => {
    const editor = editorWith('the docs');
    select(editor, 'the docs');
    dialog.open();
    type('https://example.com');
    (document.getElementById('link-cancel') as HTMLButtonElement).click();

    expect(editor.getMarkdown()).toBe('the docs');
  });

  it.each([
    'not a url',
    'javascript:alert(1)',
    '   ',
  ])('refuses %s quietly, leaving the dialog open and the document untouched', (bad) => {
    const editor = editorWith('the docs');
    select(editor, 'the docs');
    dialog.open();
    type(bad);
    confirm().click();

    expect(editor.getMarkdown()).toBe('the docs');
    expect(overlay().classList.contains('hidden')).toBe(false);
  });
});
