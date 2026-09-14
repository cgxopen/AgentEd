/**
 * A table pasted from anywhere else (#293), as bytes in and bytes out.
 *
 * **Nothing here needs a browser or a hand.** The defect was found with real
 * Ctrl+C and Ctrl+V in Chromium, and it reproduces byte for byte in this
 * harness: a paste is a document change, so every row below asserts the
 * markdown the document is saved as.
 *
 * Two halves are asserted, because the repair has two:
 *
 *   - **inside a table**, the pasted cells overwrite from the caret cell and
 *     the table grows only at its right edge, which is what cells copied from
 *     this editor have always done — measured before this file existed as
 *     `a1, a2, x, y, a3`, a row split open with `a3` pushed under another
 *     header;
 *   - **outside one**, the text after the caret stays where it was instead of
 *     being swallowed into the last pasted cell — `before text|after` used to
 *     come back as a table whose last cell read `y after`.
 *
 * The regression half is asserted beside it and is the larger part of this
 * file: a copy from this editor, a paste that is not a table, `Ctrl+Shift+V`,
 * a fenced block, and undo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const editors: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = createEditor(element);
  if (markdown.length > 0) instance.setMarkdown(markdown);
  editors.push(instance);
  return instance;
}

interface Clipboard {
  text: string;
  html?: string;
}

/**
 * A paste dispatched at the editor as a real `ClipboardEvent`, rather than
 * through `view.someProp`.
 *
 * The distinction matters for one group of rows here. A paste of cells copied
 * from this editor is **declined** by this plugin and answered by the table
 * extension, which reads the slice ProseMirror parsed from the clipboard — so
 * a helper that passes a slice of its own would assert a different paste than
 * the one the user makes. A dispatched event carries the clipboard itself and
 * lets every handler resolve exactly as it does in the app.
 */
function paste(instance: EditorInstance, clipboard: Clipboard, forcePlain = false): void {
  if (forcePlain) {
    instance.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'V',
        code: 'KeyV',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  }
  const data = new DataTransfer();
  if (clipboard.html !== undefined) data.setData('text/html', clipboard.html);
  data.setData('text/plain', clipboard.text);
  instance.editor.view.dom.dispatchEvent(
    new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    } as ClipboardEventInit),
  );
}

/** What this editor puts on the clipboard for the current selection. */
function copy(instance: EditorInstance): Clipboard {
  const data = new DataTransfer();
  instance.editor.view.dom.dispatchEvent(
    new ClipboardEvent('copy', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    } as ClipboardEventInit),
  );
  return { html: data.getData('text/html'), text: data.getData('text/plain') };
}

/** The caret at the end of the given text. */
function caretAfter(instance: EditorInstance, text: string): void {
  let position = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (position >= 0 || !node.isText || node.text === undefined) return position < 0;
    const at = node.text.indexOf(text);
    if (at >= 0) position = pos + at + text.length;
    return false;
  });
  if (position < 0) throw new Error(`text not found: ${text}`);
  instance.editor.commands.setTextSelection(position);
}

/** The position of the cell whose own text is exactly `text`. */
function cellAt(instance: EditorInstance, text: string): number {
  let position = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (position >= 0) return false;
    const isCell = node.type.name === 'tableCell' || node.type.name === 'tableHeader';
    if (isCell && node.firstChild?.textContent === text) position = pos;
    return position < 0;
  });
  if (position < 0) throw new Error(`cell not found: ${text}`);
  return position;
}

const saved = (instance: EditorInstance) =>
  instance.editor.isDestroyed ? '' : instance.getMarkdown().trim();

/** Three columns, one alignment each, so a cell that moves column shows it. */
const ALIGNED_TABLE = [
  '| h1 | h2 | h3 |',
  '| :--- | :---: | ---: |',
  '| a1 | a2 | a3 |',
  '| b1 | b2 | b3 |',
].join('\n');

/** A table as a web page puts it on the clipboard. */
const PAGE_TABLE = '<table><tr><td>x</td><td>y</td></tr></table>';

/** A table as an editor or a chat puts it on the clipboard: markdown text. */
const TEXT_TABLE = '| x | y |\n| --- | --- |\n| 1 | 2 |';

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy();
  document.body.innerHTML = '';
});

describe('a table pasted into a table', () => {
  it('overwrites from the caret cell instead of splitting the row open', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a2');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    // `a3` used to be pushed to a fourth column and read under another header.
    expect(saved(instance)).toBe(
      ['| h1 | h2 | h3 |', '| :--- | :---: | ---: |', '| a1 | x | y |', '| b1 | b2 | b3 |'].join(
        '\n',
      ),
    );
  });

  it('grows the table at its right edge, and every alignment stays on its own column', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a3');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(
      [
        '| h1 | h2 | h3 |  |',
        '| :--- | :---: | ---: | --- |',
        '| a1 | a2 | x | y |',
        '| b1 | b2 | b3 |  |',
      ].join('\n'),
    );
  });

  it('answers a markdown table on the clipboard the same way', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a1');
    paste(instance, { text: TEXT_TABLE });

    // Two pasted rows, so the second lands in the row below; nothing is
    // inserted in the middle of either.
    expect(saved(instance)).toBe(
      ['| h1 | h2 | h3 |', '| :--- | :---: | ---: |', '| x | y | a3 |', '| 1 | 2 | b3 |'].join(
        '\n',
      ),
    );
  });

  it('leaves the header row of the table it lands in where it was', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'h1');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    // `h2` used to leave the centered column and `b1` used to move under `y`.
    expect(saved(instance)).toBe(
      ['| x | y | h3 |', '| :--- | :---: | ---: |', '| a1 | a2 | a3 |', '| b1 | b2 | b3 |'].join(
        '\n',
      ),
    );
  });

  it('acts on the inner table when the caret is in one', () => {
    const nested = [
      '| o1 | o2 |',
      '| --- | --- |',
      '| <table><tr><td>i1</td></tr></table> | p2 |',
    ].join('\n');
    const instance = editorWith(nested);
    caretAfter(instance, 'i1');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(
      [
        '| o1 | o2 |',
        '| --- | --- |',
        '| <table><tr><th>x</th><th>y</th></tr></table> | p2 |',
      ].join('\n'),
    );
  });

  it('reads a table inside a blockquote as cells too', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a2');
    paste(instance, { html: `<blockquote>${PAGE_TABLE}</blockquote>`, text: 'x\ty' });

    // A guard that looked at the top level only left this on the path that
    // split the row open, `a1, a2, x, y, a3`.
    expect(saved(instance)).toBe(
      ['| h1 | h2 | h3 |', '| :--- | :---: | ---: |', '| a1 | x | y |', '| b1 | b2 | b3 |'].join(
        '\n',
      ),
    );
  });

  it('does not split the row for a table beside a heading', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a2');
    paste(instance, { html: `<h2>T</h2>${PAGE_TABLE}`, text: 'T\nx\ty' });

    // The clipboard is not cells, so it keeps the answer it had before this
    // repair: it lands inside the one cell. What that cell then holds is not
    // decided here; that no value leaves its column is.
    const rows = saved(instance).split('\n');
    expect(rows).toHaveLength(4);
    expect(rows.slice(0, 2)).toEqual(['| h1 | h2 | h3 |', '| :--- | :---: | ---: |']);
    expect(rows[2]).toMatch(/^\| a1 \| a2.* \| a3 \|$/);
    expect(rows[3]).toBe('| b1 | b2 | b3 |');
  });

  it('restores the document with one undo', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a2');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });
    instance.editor.commands.undo();

    expect(saved(instance)).toBe(ALIGNED_TABLE);
  });

  it('writes a file that holds still on a second save', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a2');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });
    const first = saved(instance);

    const reopened = editorWith(first);
    expect(saved(reopened)).toBe(first);
  });
});

describe('a table pasted anywhere else keeps the text that follows the caret', () => {
  it('leaves the rest of the paragraph below the table', () => {
    const instance = editorWith('before text after');
    caretAfter(instance, 'before text');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    // `after` used to be fitted into the last pasted cell, as `y after`.
    expect(saved(instance)).toBe(
      ['before text', '', '| x | y |', '| --- | --- |', '', 'after'].join('\n'),
    );
  });

  it('leaves the rest of a quoted line below the table, inside the quote', () => {
    const instance = editorWith('> quoted line');
    caretAfter(instance, 'quoted');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(
      ['> quoted', '> ', '> | x | y |', '> | --- | --- |', '> ', '> line'].join('\n'),
    );
  });

  it('leaves the rest of a heading below the table', () => {
    const instance = editorWith('# Title here');
    caretAfter(instance, 'Title');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(
      ['# Title', '', '| x | y |', '| --- | --- |', '', '# here'].join('\n'),
    );
  });

  it('keeps the text after the caret for a table beside a heading', () => {
    const instance = editorWith('before text after');
    caretAfter(instance, 'before text');
    paste(instance, { html: `<h2>T</h2>${PAGE_TABLE}`, text: 'T\nx\ty' });

    expect(saved(instance)).toBe(
      ['before textT', '', '| x | y |', '| --- | --- |', '', 'after'].join('\n'),
    );
  });

  it('keeps the text after the caret for a table inside a blockquote', () => {
    const instance = editorWith('before text after');
    caretAfter(instance, 'before text');
    paste(instance, { html: `<blockquote>${PAGE_TABLE}</blockquote>`, text: 'x\ty' });

    // The open end runs down into the table one level below the top, which is
    // where a top-level test did not look.
    expect(saved(instance)).toBe(
      ['before text', '', '| x | y |', '| --- | --- |', '', 'after'].join('\n'),
    );
  });

  it('keeps the whole paragraph when the caret is at its start', () => {
    const instance = editorWith('before text after');
    instance.editor.commands.setTextSelection(1);
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(
      ['| x | y |', '| --- | --- |', '', 'before text after'].join('\n'),
    );
  });

  it('restores the document with one undo', () => {
    const instance = editorWith('before text after');
    caretAfter(instance, 'before text');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });
    instance.editor.commands.undo();

    expect(saved(instance)).toBe('before text after');
  });
});

describe('what the repair must not change', () => {
  it('a row copied from this editor still overwrites and grows at the right', () => {
    const instance = editorWith(ALIGNED_TABLE);
    instance.editor.commands.setCellSelection({
      anchorCell: cellAt(instance, 'a1'),
      headCell: cellAt(instance, 'a2'),
    });
    const clipboard = copy(instance);
    expect(clipboard.html).toContain('data-pm-slice');

    caretAfter(instance, 'a3');
    paste(instance, clipboard);

    expect(saved(instance)).toBe(
      [
        '| h1 | h2 | h3 |  |',
        '| :--- | :---: | ---: | --- |',
        '| a1 | a2 | a1 | a2 |',
        '| b1 | b2 | b3 |  |',
      ].join('\n'),
    );
  });

  it('a column copied from this editor still grows the table at the bottom', () => {
    const instance = editorWith(ALIGNED_TABLE);
    instance.editor.commands.setCellSelection({
      anchorCell: cellAt(instance, 'a1'),
      headCell: cellAt(instance, 'b1'),
    });
    const clipboard = copy(instance);

    caretAfter(instance, 'b3');
    paste(instance, clipboard);

    expect(saved(instance)).toBe(
      [
        '| h1 | h2 | h3 |',
        '| :--- | :---: | ---: |',
        '| a1 | a2 | a3 |',
        '| b1 | b2 | a1 |',
        '|  |  | b1 |',
      ].join('\n'),
    );
  });

  it('a table beside a heading, pasted over selected cells, is not tiled across them', () => {
    const instance = editorWith(ALIGNED_TABLE);
    instance.editor.commands.setCellSelection({
      anchorCell: cellAt(instance, 'a1'),
      headCell: cellAt(instance, 'a2'),
    });
    paste(instance, { html: `<h2>T</h2>${PAGE_TABLE}`, text: 'T\nx\ty' });

    // Handing every table-holding clipboard to the table handler wrote this
    // content into both cells. The row it lands in is asserted by what it must
    // not contain twice, not byte for byte: that output does not hold still on
    // a second save on main either, which is its own question.
    const row = saved(instance).split('\n')[2];
    expect(row.match(/<table>/g)).toHaveLength(1);
    expect(row.endsWith('| a3 |')).toBe(true);
  });

  it('a pasted paragraph still merges into the cell the caret is in', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a2');
    paste(instance, { html: '<p>plain words</p>', text: 'plain words' });

    expect(saved(instance)).toBe(
      [
        '| h1 | h2 | h3 |',
        '| :--- | :---: | ---: |',
        '| a1 | a2plain words | a3 |',
        '| b1 | b2 | b3 |',
      ].join('\n'),
    );
  });

  it('a pasted paragraph still merges into the sentence at the caret', () => {
    const instance = editorWith('before text after');
    caretAfter(instance, 'before text');
    paste(instance, { html: '<p>merged words</p>', text: 'merged words' });

    expect(saved(instance)).toBe('before textmerged words after');
  });

  it('Ctrl+Shift+V still inserts the characters, in a cell', () => {
    const instance = editorWith(ALIGNED_TABLE);
    caretAfter(instance, 'a2');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' }, true);

    expect(saved(instance)).toBe(
      [
        '| h1 | h2 | h3 |',
        '| :--- | :---: | ---: |',
        '| a1 | a2x y | a3 |',
        '| b1 | b2 | b3 |',
      ].join('\n'),
    );
  });

  it('Ctrl+Shift+V still inserts the characters, outside a table', () => {
    const instance = editorWith('before text after');
    caretAfter(instance, 'before text');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' }, true);

    expect(saved(instance)).toBe('before textx y after');
  });

  it('a fenced block still takes the characters literally', () => {
    const instance = editorWith('```js\nconst a = 1;\n```');
    caretAfter(instance, 'const a');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(['```js', 'const ax\ty = 1;', '```'].join('\n'));
  });

  it('a bullet item still takes the table as a block of the item', () => {
    const instance = editorWith('- one\n- two');
    caretAfter(instance, 'one');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(
      ['- one', '', '  | x | y |', '  | --- | --- |', '- two'].join('\n'),
    );
  });

  it('a task item still takes the table as a block of the item', () => {
    const instance = editorWith('- [ ] one\n- [ ] two');
    caretAfter(instance, 'one');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(
      ['- [ ] one', '', '  | x | y |', '  | --- | --- |', '- [ ] two'].join('\n'),
    );
  });

  it('a table pasted into an empty document is still the whole document', () => {
    const instance = editorWith('');
    paste(instance, { html: PAGE_TABLE, text: 'x\ty' });

    expect(saved(instance)).toBe(['| x | y |', '| --- | --- |'].join('\n'));
  });
});
