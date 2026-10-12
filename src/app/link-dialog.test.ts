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
const error = () => document.getElementById('link-error') as HTMLElement;

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

  // Inverted from #40: a bare host used to gain an implied `https://`. Nothing
  // separates `example.com` from `README.md` by shape, and guessing wrong on
  // the second is what a markdown editor does all day, so the guess went (#42).
  it('adds no scheme to a bare host', () => {
    const editor = editorWith('docs');
    select(editor, 'docs');
    dialog.open();
    type('example.com');
    pressEnter();

    expect(editor.getMarkdown()).toBe('[docs](example.com)');
  });

  // #42, the case the owner met: the dialog refused it outright, and once it
  // stopped refusing, `setLink` silently inserted nothing for the paths with a
  // directory in them.
  it.each([
    './notes.md',
    'notes.md',
    'README.md',
    'docs/guide.md',
    'docs/ADR/ADR-001.md',
    '../a/b.md',
    '/docs/x.md',
    '#section',
  ])('writes the relative address %s exactly as typed', (address) => {
    const editor = editorWith('the docs');
    select(editor, 'the docs');
    dialog.open();
    type(address);
    confirm().click();

    expect(editor.getMarkdown()).toBe(`[the docs](${address})`);
    expect(overlay().classList.contains('hidden')).toBe(true);
  });

  it('round-trips a relative link it created, byte for byte (R-C2)', () => {
    const editor = editorWith('read the docs now');
    select(editor, 'the docs');
    dialog.open();
    type('docs/guide.md');
    confirm().click();

    const markdown = editor.getMarkdown();
    editor.setMarkdown(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });
});

describe('link dialog — on an existing relative link', () => {
  it('opens pre-filled with the relative address, and offers Remove', () => {
    const editor = editorWith('[the guide](docs/guide.md)');
    caretIn(editor, 'the guide');
    dialog.open();

    expect(input().value).toBe('docs/guide.md');
    expect(remove().classList.contains('hidden')).toBe(false);
  });

  it('unmakes a relative link, keeping the text', () => {
    const editor = editorWith('[notes](./notes.md)');
    caretIn(editor, 'notes');
    dialog.open();
    remove().click();

    expect(editor.getMarkdown()).toBe('notes');
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

  it('changes one of two links side by side with the same address, and not the other (#565)', () => {
    // Two such links stay two since #565 (D5), so the dialog is asked for the
    // link under the caret and not the run of both.
    const editor = editorWith('[aa](https://example.com)[bb](https://example.com)');
    caretIn(editor, 'bb');
    dialog.open();
    type('https://example.org');
    confirm().click();

    expect(editor.getMarkdown()).toBe('[aa](https://example.com)[bb](https://example.org)');
  });

  it('removes one of two links side by side with the same address, and not the other (#565)', () => {
    const editor = editorWith('[aa](https://example.com)[bb](https://example.com)');
    caretIn(editor, 'aa');
    dialog.open();
    remove().click();

    expect(editor.getMarkdown()).toBe('aa[bb](https://example.com)');
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
    'file:///etc/passwd',
    'data:text/html,x',
    '//evil.com',
    '\\\\evil.com',
    'C:\\notes\\x.md',
    '   ',
  ])('refuses %s, leaving the dialog open and the document untouched', (bad) => {
    const editor = editorWith('the docs');
    select(editor, 'the docs');
    dialog.open();
    type(bad);
    confirm().click();

    expect(editor.getMarkdown()).toBe('the docs');
    expect(overlay().classList.contains('hidden')).toBe(false);
  });
});

// A refusal that explains nothing reads as a broken application — the finding
// from #13, applied here.
describe('link dialog — a refusal says why', () => {
  function refuse(value: string): void {
    const editor = editorWith('the docs');
    select(editor, 'the docs');
    dialog.open();
    type(value);
    confirm().click();
  }

  // The wording changed with the rule (#42): it named three schemes, which now
  // reads as "relative paths are unsupported" — the thing this issue fixed.
  it.each(['not a url', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'names what is supported when %s is rejected',
    (bad) => {
      refuse(bad);
      expect(error().classList.contains('hidden')).toBe(false);
      expect(error().textContent).toBe(
        'Use a web address (https://…), an email address (mailto:…), or a relative path (./notes.md).',
      );
    },
  );

  it('asks for an address instead of talking about schemes when the field is empty', () => {
    refuse('   ');
    expect(error().textContent).toContain('Enter an address');
  });

  it('says nothing until something is actually refused', () => {
    const editor = editorWith('the docs');
    select(editor, 'the docs');
    dialog.open();

    expect(error().classList.contains('hidden')).toBe(true);
  });

  it('drops the complaint as soon as the user starts correcting it', () => {
    refuse('not a url');
    type('https://example.com');
    input().dispatchEvent(new Event('input', { bubbles: true }));

    expect(error().classList.contains('hidden')).toBe(true);
  });

  it('does not carry the complaint into the next time the dialog opens', () => {
    refuse('not a url');
    (document.getElementById('link-cancel') as HTMLButtonElement).click();
    dialog.open();

    expect(error().classList.contains('hidden')).toBe(true);
  });

  it('clears once the address is accepted', () => {
    const editor = editorWith('the docs');
    select(editor, 'the docs');
    dialog.open();
    type('javascript:alert(1)');
    confirm().click();
    type('https://example.com');
    confirm().click();

    expect(editor.getMarkdown()).toBe('[the docs](https://example.com)');
    expect(error().classList.contains('hidden')).toBe(true);
  });
});
