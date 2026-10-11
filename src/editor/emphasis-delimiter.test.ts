import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * Emphasis keeps the delimiter the file wrote (#566). See
 * `markdown/emphasis-delimiter.ts` for the route; the unedited save of the
 * whole path is pinned by the CommonMark suite and the round-trip table.
 */

let instances: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

function paste(instance: EditorInstance, clipboard: { text?: string; html?: string }): void {
  const data: Record<string, string> = {};
  if (clipboard.text !== undefined) data['text/plain'] = clipboard.text;
  if (clipboard.html !== undefined) data['text/html'] = clipboard.html;
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

/** The position of the first character of `text` in the document. */
function positionOf(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) {
      found = pos + (node.text.indexOf(text) ?? 0);
    }
  });
  if (found === -1) throw new Error(`no ${text} in the document`);
  return found;
}

describe('an unedited save keeps the delimiter of every emphasis (#566)', () => {
  it.each([
    ['underscore emphasis and strong emphasis', 'Some _a_ and __b__ here.'],
    ['asterisk emphasis and strong emphasis, as before', 'Some *a* and **b** here.'],
    ['an emphasis nested in a strong emphasis', '__a _b_ c__'],
    ['three underscores', '___x___'],
    ['an emphasis next to one with the other delimiter', 'Say _a_ and *b* now.'],
    ['inside a link text', 'See [_the guide_](https://e.com) now.'],
    ['in a heading', '## A _quiet_ heading'],
    ['in a list item', '- an _item_ here\n- and __another__'],
    ['across a soft break', 'one _two\nthree_ four'],
    ['an asterisk emphasis inside a word', 'foo*bar*baz'],
  ])('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});

describe('what a mark nesting does to the delimiter (#566)', () => {
  it('an emphasis around a strong one splits around it, as with asterisks, and keeps its delimiter', () => {
    // Known exception: two overlapping marks have exactly one nesting. On main
    // the same file came back `*a* ***b*** *c*`.
    expect(editorWith('_a **b** c_').getMarkdown()).toBe('_a_ **_b_** _c_');
  });
});

describe('where an underscore cannot stand, the asterisk is written (#566)', () => {
  it('a letter typed against an underscore emphasis puts it inside a word', () => {
    const editor = editorWith('Say _quiet_ now.');
    const at = positionOf(editor, 'quiet');
    // A plain letter just before the emphasis, outside it.
    editor.editor.view.dispatch(editor.editor.state.tr.insert(at, editor.editor.schema.text('x')));
    expect(editor.getMarkdown()).toBe('Say x*quiet* now.');
  });

  it('a letter typed after the end of a strong emphasis does the same', () => {
    const editor = editorWith('Say __bold__ now.');
    const at = positionOf(editor, 'bold') + 4;
    editor.editor.view.dispatch(editor.editor.state.tr.insert(at, editor.editor.schema.text('y')));
    expect(editor.getMarkdown()).toBe('Say **bold**y now.');
  });

  it('punctuation beside it leaves the underscore', () => {
    const editor = editorWith('Say (_quiet_) now.');
    expect(editor.getMarkdown()).toBe('Say (_quiet_) now.');
  });
});

describe('an emphasis the editor makes is written with asterisks (#566)', () => {
  it.each([
    ['Ctrl+I', 'i', 'Make *word* here.'],
    ['Ctrl+B', 'b', 'Make **word** here.'],
  ])('%s on a new word', (_label, key, written) => {
    const editor = editorWith('Make word here.');
    const at = positionOf(editor, 'word');
    editor.editor.commands.setTextSelection({ from: at, to: at + 4 });
    const { view } = editor.editor;
    view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key, ctrlKey: true })),
    );
    expect(editor.getMarkdown()).toBe(written);
  });

  it.each([
    [
      'the italic command of the toolbar',
      (e: EditorInstance) => e.editor.commands.toggleItalic(),
      'Make *word* here.',
    ],
    [
      'the bold command of the toolbar',
      (e: EditorInstance) => e.editor.commands.toggleBold(),
      'Make **word** here.',
    ],
  ])('%s', (_label, command, written) => {
    const editor = editorWith('Make word here.');
    const at = positionOf(editor, 'word');
    editor.editor.commands.setTextSelection({ from: at, to: at + 4 });
    command(editor);
    expect(editor.getMarkdown()).toBe(written);
  });

  it('typing inside an underscore emphasis keeps the underscores', () => {
    const editor = editorWith('Say _quiet_ now.');
    const at = positionOf(editor, 'quiet') + 2;
    editor.editor.chain().setTextSelection(at).insertContent('X').run();
    expect(editor.getMarkdown()).toBe('Say _quXiet_ now.');
  });

  it('a rich paste of an emphasis writes asterisks', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { html: '<p><em>a</em> and <strong>b</strong></p>', text: 'a and b' });
    expect(editor.getMarkdown()).toBe('*a* and **b**start');
  });

  it('a page that spells the attribute pastes asterisks too (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, {
      html: '<p><em data-emphasis-delimiter="_">a</em> b</p>',
      text: 'a b',
    });
    expect(editor.getMarkdown()).toBe('*a* bstart');
  });
});
