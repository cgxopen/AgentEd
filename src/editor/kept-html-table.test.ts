import { afterEach, describe, expect, it } from 'vitest';
import { applyLineConventions, detectLineConventions } from '../formats/line-conventions';
import { HTML_SOURCE, KEPT_HTML_SOURCE } from './kept-html-table';
import { htmlToMarkdown } from './markdown/serialize';
import { TABLE_HTML_SOURCE_ATTRIBUTE } from './markdown/table-html-source';
import { createEditor, type EditorInstance } from './setup';

/**
 * #283 at the level the user meets it: a table the file wrote as raw HTML is
 * written back as those bytes while it is unedited, and as GFM once it is
 * edited. The untouched rows, one per construct, are in the editor round-trip
 * table in `roundtrip.test.ts`, where the second save is checked for every
 * row. This file holds what that table cannot express: an edit, an undo, a
 * paste, and the GFM tables beside an HTML one.
 *
 * All of it is bytes in and bytes out. Nothing here depends on layout, focus
 * or display, so nothing here is owed to a manual pass.
 */

const editors: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(markdown);
  editors.push(editor);
  return editor;
}

/** What the save path writes for an unedited document: the serializer text, with the file line conventions. */
function saved(markdown: string): string {
  return applyLineConventions(editorWith(markdown).getMarkdown(), detectLineConventions(markdown));
}

/** The position just after the first occurrence of `text` in the document. */
function endOf(editor: EditorInstance, text: string): number {
  let found = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || node.text === undefined) return found < 0;
    const at = node.text.indexOf(text);
    if (at >= 0) found = pos + at + text.length;
    return false;
  });
  if (found < 0) throw new Error(`"${text}" is not in the document`);
  return found;
}

function typeAfter(editor: EditorInstance, text: string, typed: string): void {
  editor.editor.chain().setTextSelection(endOf(editor, text)).insertContent(typed).run();
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
});

const SIMPLE = '<table><tr><td>a</td></tr></table>';
const COLSPAN = '<table><tr><th>a</th><th>b</th></tr><tr><td colspan="2">wide</td></tr></table>';

describe('an edit decides, and nothing short of an edit does', () => {
  it('writes an edited table as GFM', () => {
    const editor = editorWith(SIMPLE);
    typeAfter(editor, 'a', 'Z');
    expect(editor.getMarkdown()).toBe('| aZ |\n| --- |');
  });

  it('writes the source again once the edit is undone', () => {
    // Nothing tracks the edit, so there is nothing for undo to reset: the
    // table is equal to its source again, and that is the whole check.
    const editor = editorWith(SIMPLE);
    typeAfter(editor, 'a', 'Z');
    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe(SIMPLE);
  });

  it('writes a table that gained a row as GFM, and the source again after undo', () => {
    // A structural edit rather than typed text: the cells change, not a word.
    const editor = editorWith(SIMPLE);
    editor.editor.chain().setTextSelection(endOf(editor, 'a')).addRowAfter().run();
    expect(editor.getMarkdown()).toBe('| a |\n| --- |\n|  |');
    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe(SIMPLE);
  });

  it('keeps the table when the edit is somewhere else in the document', () => {
    const editor = editorWith(`before\n\n${SIMPLE}`);
    typeAfter(editor, 'before', 'Z');
    expect(editor.getMarkdown()).toBe(`beforeZ\n\n${SIMPLE}`);
  });

  it('keeps the table when the caret only visits it', () => {
    const editor = editorWith(SIMPLE);
    editor.editor.chain().focus().setTextSelection(endOf(editor, 'a')).run();
    expect(editor.getMarkdown()).toBe(SIMPLE);
  });

  it('decides per table: of two, only the edited one is written as GFM', () => {
    const editor = editorWith(`${SIMPLE}\n\n<table><tr><td>b</td></tr></table>`);
    typeAfter(editor, 'a', 'Z');
    expect(editor.getMarkdown()).toBe('| aZ |\n| --- |\n\n<table><tr><td>b</td></tr></table>');
  });

  it('keeps a table that was deleted and brought back with undo', () => {
    const editor = editorWith(`p\n\n${SIMPLE}`);
    editor.editor.chain().setTextSelection(endOf(editor, 'a')).deleteTable().run();
    expect(editor.getMarkdown()).toBe('p');
    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe(`p\n\n${SIMPLE}`);
  });

  it('loses what GFM cannot hold at the moment of the edit, and says it here in bytes', () => {
    // The owner decision of 2026-09-13, recorded in REQUIREMENTS: once edited,
    // the table is written as every table was before #283. The span is gone
    // and an empty cell stands where it reached.
    const editor = editorWith(COLSPAN);
    typeAfter(editor, 'wide', 'Z');
    expect(editor.getMarkdown()).toBe('| a | b |\n| --- | --- |\n| wideZ |  |');
  });
});

describe('the bytes never leave the editor except through the save path', () => {
  it('holds the source on the node and renders it nowhere', () => {
    const editor = editorWith(SIMPLE);
    const table = editor.editor.state.doc.firstChild;
    expect(table?.attrs[HTML_SOURCE]).toBe(SIMPLE);
    expect(table?.attrs[KEPT_HTML_SOURCE]).toBeNull();
    // `getHTML` is what the clipboard and every other HTML route are built
    // from. The save path marks its own copy and never dispatches it.
    expect(editor.editor.getHTML()).not.toContain(TABLE_HTML_SOURCE_ATTRIBUTE);
    editor.getMarkdown();
    expect(editor.editor.state.doc.firstChild?.attrs[KEPT_HTML_SOURCE]).toBeNull();
  });

  it('writes a copy made from the rendered HTML as GFM, because the copy carries no bytes', () => {
    const copy = editorWith('');
    copy.editor.commands.setContent(editorWith(SIMPLE).editor.getHTML());
    expect(copy.getMarkdown()).toBe('| a |\n| --- |');
  });

  it('writes the bytes only when the caller asks for kept tables', () => {
    // Paste runs rich HTML from any page through the same serializer, and a
    // page can carry the attribute.
    const html = `<table ${TABLE_HTML_SOURCE_ATTRIBUTE}="${encodeURIComponent(SIMPLE)}"><tr><td>other</td></tr></table>`;
    expect(htmlToMarkdown(html)).toBe('| other |\n| --- |');
    expect(htmlToMarkdown(html, { keepHtmlTables: true })).toBe(SIMPLE);
  });
});

describe('paste is not affected', () => {
  /** Fire a paste carrying the given clipboard contents. */
  function paste(editor: EditorInstance, data: Record<string, string>): void {
    const event = {
      clipboardData: {
        types: Object.keys(data),
        getData: (type: string) => data[type] ?? '',
        files: [],
      },
      preventDefault: () => undefined,
    } as unknown as ClipboardEvent;
    const { view } = editor.editor;
    const handled = view.someProp('handlePaste', (handler) =>
      handler(view, event, view.state.selection.content()),
    );
    expect(handled).toBe(true);
  }

  it('writes an HTML table pasted as rich HTML as GFM', () => {
    const editor = editorWith('before');
    editor.editor.commands.setTextSelection(endOf(editor, 'before'));
    paste(editor, { 'text/html': '<table><tr><td>p</td></tr><tr><td>q</td></tr></table>' });
    expect(editor.getMarkdown()).toBe('before\n\n| p |\n| --- |\n| q |');
  });

  it('does not let a pasted page choose the table through the attribute', () => {
    // Measured with the attribute honoured on this route: the pasted table
    // holding `p` arrived as `other`.
    const forged = encodeURIComponent('<table><tr><td>other</td></tr></table>');
    const editor = editorWith('before');
    editor.editor.commands.setTextSelection(endOf(editor, 'before'));
    paste(editor, {
      'text/html': `<table ${TABLE_HTML_SOURCE_ATTRIBUTE}="${forged}"><tr><td>p</td></tr><tr><td>q</td></tr></table>`,
    });
    expect(editor.getMarkdown()).toBe('before\n\n| p |\n| --- |\n| q |');
  });
});

/**
 * The regression half, and the one that matters more because the repair
 * narrows something. A change that quietly wrote GFM tables as HTML would
 * pass every row above and destroy every document with a table.
 *
 * So each of the five spellings the #93 exception normalises, and each #93
 * spelling that is kept, is written **beside an HTML table** and compared with
 * what the same GFM table writes on its own: the GFM part must not move by a
 * byte, and the HTML table must still be kept.
 */
describe('a GFM table is still written as GFM, beside an HTML table', () => {
  it.each([
    ['without outer pipes', 'a | b\n--- | ---\n1 | 2'],
    ['indented', '  | a | b |\n  | --- | --- |\n  | 1 | 2 |'],
    ['with no spaces at all', '|a|b|\n|---|---|\n|1|2|'],
    ['with a column whose rows disagree', '| a   | b   |\n| --- | --- |\n| c | d |'],
    ['aligned by display width', '| Done | x |\n| ---- | --- |\n| ✅  | y |'],
    ['with hugged cells', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['with a tight separator', '| Shortcut | Action |\n|----------|--------|\n| `x` | y |'],
    [
      'padded wider than its content',
      '| a      | b      |\n| ------ | ------ |\n| c      | d      |',
    ],
    ['with alignment markers', '| a | b |\n| :-- | --: |\n| 1 | 2 |'],
  ])('a table %s', (_label, gfm) => {
    const alone = saved(gfm);
    expect(alone).not.toContain('<table');
    expect(saved(`${gfm}\n\n${SIMPLE}`)).toBe(`${alone}\n\n${SIMPLE}`);
    expect(saved(`${SIMPLE}\n\n${gfm}`)).toBe(`${SIMPLE}\n\n${alone}`);
  });

  it('writes an edited GFM table as GFM beside a kept HTML table', () => {
    const editor = editorWith(`| a | b |\n| --- | --- |\n| 1 | 2 |\n\n${SIMPLE}`);
    typeAfter(editor, '1', 'Z');
    expect(editor.getMarkdown()).toBe(`| a | b |\n| --- | --- |\n| 1Z | 2 |\n\n${SIMPLE}`);
  });

  it('keeps an indented HTML table indented', () => {
    // Here rather than in the round-trip table, whose runner trims what it
    // saves and so cannot see a leading space.
    const indented = '  <table><tr><td>a</td></tr></table>';
    expect(saved(indented)).toBe(indented);
  });

  it('gives a GFM table no source to keep', () => {
    // What tells the two apart is the token `marked` hands over: a GFM table
    // reaches the table renderer, which stamps nothing.
    const editor = editorWith('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(editor.editor.state.doc.firstChild?.attrs[HTML_SOURCE]).toBeNull();
  });
});
