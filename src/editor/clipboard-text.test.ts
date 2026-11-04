import { getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MARKDOWN_COPY_BLOCKS,
  MAX_MARKDOWN_COPY_SIZE,
  parseFromClipboard,
  wordsOfCopy,
} from './clipboard-text';
import { markdownOf } from './document-markdown';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * The plain text of a copy and a cut (#697): the markdown the file would hold
 * for what was copied, with the shapes of the owner decisions of 2026-11-04.
 *
 * A copy is made the way ProseMirror makes one, `serializeForClipboard` over
 * the content of the selection, so the plain text comes from the same prop the
 * application asks, and the HTML flavour beside it from the same serializer.
 * The rows are the rows of the step zero on the issue, measured there in
 * Chromium under the CSP of the application.
 */
const DOCUMENT = [
  '# A heading',
  '',
  'Plain words and a **bold** word with a [link](https://example.com/a) and a note[^n] and https://example.com/bare here.',
  '',
  'Second paragraph, one line.',
  '',
  '- first item',
  '- second item with more words',
  '- third item',
  '',
  'Tasks:',
  '',
  '- [ ] open task',
  '- [x] done task',
  '',
  '> A quote line.',
  '',
  '```js',
  'const a = 1;',
  'const b = 2;',
  '```',
  '',
  '| H1 | H2 |',
  '| --- | --- |',
  '| a1 | b1 |',
  '| a2 | b2 |',
  '',
  '![alt text](assets/pic.png)',
  '',
  '<table>',
  '<tr><td>r1</td><td>r2</td></tr>',
  '</table>',
  '',
  '<details>',
  '<summary>More</summary>',
  '',
  'Hidden text.',
  '',
  '</details>',
  '',
  'Tail paragraph.',
  '',
  '[^n]: The note text.',
  '',
].join('\n');

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
});

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  instance = createEditor(element);
  instance.setMarkdown(markdown);
  return instance;
}

/** Select from the start of `from` to the end of `to`, by the text they hold. */
function selectText(editor: EditorInstance, from: string, to = from): void {
  const at = (text: string) => {
    let found = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text?.includes(text)) {
        found = pos + node.text.indexOf(text);
      }
    });
    if (found < 0) throw new Error(`text not found: ${text}`);
    return found;
  };
  editor.editor.commands.setTextSelection({ from: at(from), to: at(to) + to.length });
}

/** Where every cell of the document starts, in document order. */
function cellPositions(editor: EditorInstance): number[] {
  const positions: number[] = [];
  editor.editor.state.doc.descendants((node, pos) => {
    const role = node.type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') positions.push(pos);
    return true;
  });
  return positions;
}

/** Select from one cell to another, the way a drag across them does. */
function selectCells(editor: EditorInstance, from: number, to: number): void {
  const cells = cellPositions(editor);
  const done = editor.editor.commands.setCellSelection({
    anchorCell: cells[from],
    headCell: cells[to],
  });
  if (!done) throw new Error('the editor refused to make a cell selection');
}

/** Both flavours of a copy of the selection, as ProseMirror writes them. */
function copy(editor: EditorInstance): { text: string; html: string } {
  const { view } = editor.editor;
  const { dom, text } = view.serializeForClipboard(view.state.selection.content());
  return { text, html: dom.innerHTML };
}

/** The plain text TipTap writes for the selection: on `main`, every copy. */
function wordsOnMain(editor: EditorInstance): string {
  const { state, schema } = editor.editor;
  const { ranges } = state.selection;
  const from = Math.min(...ranges.map((range) => range.$from.pos));
  const to = Math.max(...ranges.map((range) => range.$to.pos));
  return getTextBetween(
    state.doc,
    { from, to },
    { textSerializers: getTextSerializersFromSchema(schema) },
  );
}

describe('the plain text of a copy is the markdown the file would hold (#697)', () => {
  it('a bold word', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'bold');
    expect(copy(editor).text).toBe('**bold**');
  });

  it('several blocks', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'A heading', 'one line.');
    expect(copy(editor).text).toBe(
      '# A heading\n\nPlain words and a **bold** word with a [link](https://example.com/a) and a note[^n] and https://example.com/bare here.\n\nSecond paragraph, one line.',
    );
  });

  it('a whole list', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'first item', 'third item');
    expect(copy(editor).text).toBe('- first item\n- second item with more words\n- third item');
  });

  it('a task list', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'open task', 'done task');
    expect(copy(editor).text).toBe('- [ ] open task\n- [x] done task');
  });

  it('a heading, all its text', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'A heading');
    expect(copy(editor).text).toBe('# A heading');
  });

  it('a quote, all its text', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'A quote line.');
    expect(copy(editor).text).toBe('> A quote line.');
  });

  it('a whole code block, all its lines, the line ending the file left after them aside', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'const a', 'b = 2;');
    expect(copy(editor).text).toBe('```js\nconst a = 1;\nconst b = 2;\n```');
  });

  it('a whole table', () => {
    const editor = editorWith(DOCUMENT);
    selectCells(editor, 0, 5);
    expect(copy(editor).text).toBe('| H1 | H2 |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |');
  });

  it('an image', () => {
    const editor = editorWith(DOCUMENT);
    let image = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') image = pos;
    });
    editor.editor.commands.setNodeSelection(image);
    expect(copy(editor).text).toBe('![alt text](assets/pic.png)');
  });

  it('a link', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'link');
    expect(copy(editor).text).toBe('[link](https://example.com/a)');
  });

  it('a bare URL stays text', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'https://example.com/bare');
    expect(copy(editor).text).toBe('https://example.com/bare');
  });

  it('a raw HTML table the file keeps as bytes is written as those bytes', () => {
    const editor = editorWith(DOCUMENT);
    selectCells(editor, 6, 7);
    expect(copy(editor).text).toBe('<table>\n<tr><td>r1</td><td>r2</td></tr>\n</table>');
  });

  it('a raw details the file keeps as bytes is written as those bytes', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'More', 'Hidden text.');
    expect(copy(editor).text).toBe(
      '<details>\n<summary>More</summary>\n\nHidden text.\n\n</details>',
    );
  });

  it('Select All writes what the save writes', () => {
    const editor = editorWith(DOCUMENT);
    editor.editor.commands.selectAll();
    expect(copy(editor).text).toBe(editor.getMarkdown().replace(/\n$/, ''));
  });
});

describe('a selection inside one block writes its inline markdown alone (#697, decision 4)', () => {
  it('part of a list item, without its marker', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'item with more');
    expect(copy(editor).text).toBe('item with more');
  });

  it('part of a task item, without its box', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'done');
    expect(copy(editor).text).toBe('done');
  });

  it('part of a heading, without its hashes', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'heading');
    expect(copy(editor).text).toBe('heading');
  });

  it('part of a quote, without its marker', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'quote');
    expect(copy(editor).text).toBe('quote');
  });

  it('part of the text of one cell, without a table', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'b1');
    const { $from } = editor.editor.state.selection;
    editor.editor.commands.setTextSelection({ from: $from.pos, to: $from.pos + 1 });
    expect(copy(editor).text).toBe('b');
  });

  it('part of a line of code, its literal text without fences', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'a = 1');
    expect(copy(editor).text).toBe('a = 1');
  });

  it('the inline marks it holds are kept', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'a ', 'bold');
    expect(copy(editor).text).toBe('a **bold**');
  });

  it('a selection crossing two items keeps the list', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'more words', 'third');
    expect(copy(editor).text).toBe('- more words\n- third');
  });
});

describe('a selection of cells is a table of those cells (#697, decision 6)', () => {
  it('two cells of one row, the row its header', () => {
    const editor = editorWith(DOCUMENT);
    selectCells(editor, 2, 3);
    expect(copy(editor).text).toBe('| a1 | b1 |\n| --- | --- |');
  });

  it('reads back as the same cells', () => {
    const source = editorWith(DOCUMENT);
    selectCells(source, 2, 3);
    const { text } = copy(source);
    source.destroy();
    const editor = editorWith(`${text}\n`);
    const cells = cellPositions(editor).map((pos) => editor.editor.state.doc.nodeAt(pos));
    expect(cells.map((cell) => cell?.textContent)).toEqual(['a1', 'b1']);
  });
});

describe('above the bounds the plain text is the words, as on main (#697, decision 7)', () => {
  it('more blocks than the bound', () => {
    const paragraphs = Array.from({ length: MAX_MARKDOWN_COPY_BLOCKS + 1 }, (_, i) => `**p${i}**`);
    const editor = editorWith(paragraphs.join('\n\n'));
    editor.editor.commands.selectAll();
    const { text } = copy(editor);
    expect(text).toBe(wordsOnMain(editor));
    expect(text).not.toContain('**');
  });

  it('as many blocks as the bound are still written as markdown', () => {
    const paragraphs = Array.from({ length: MAX_MARKDOWN_COPY_BLOCKS }, (_, i) => `**p${i}**`);
    const editor = editorWith(paragraphs.join('\n\n'));
    editor.editor.commands.selectAll();
    expect(copy(editor).text.startsWith('**p0**\n\n**p1**')).toBe(true);
  });

  it('a content larger than the size bound', () => {
    const editor = editorWith(`**bold** ${'x'.repeat(MAX_MARKDOWN_COPY_SIZE)}`);
    editor.editor.commands.selectAll();
    const { text } = copy(editor);
    expect(text).toBe(wordsOnMain(editor));
    expect(text.startsWith('bold ')).toBe(true);
  });
});

describe('the HTML flavour is the one ProseMirror writes, with the token (#697, #447)', () => {
  it('a bold word', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'bold');
    expect(copy(editor).html).toMatch(
      /^<p data-agented-copy="[0-9a-f]{32}" data-pm-slice="1 1 \[\]"><strong>bold<\/strong><\/p>$/,
    );
  });

  it('part of a list item, its context in the slice attribute', () => {
    const editor = editorWith(DOCUMENT);
    selectText(editor, 'item with more');
    const { html } = copy(editor);
    expect(html).toMatch(/^<p data-agented-copy="[0-9a-f]{32}" data-pm-slice="1 1 \[/);
    expect(html).toContain('bulletList');
    expect(html.endsWith('>item with more</p>')).toBe(true);
  });
});

describe('the words of a copy from AgentEd are the plain text of main (#697, decision 3)', () => {
  it('the reader of ProseMirror is there', () => {
    expect(typeof parseFromClipboard).toBe('function');
  });

  const rows: [string, (editor: EditorInstance) => void][] = [
    ['a bold word', (editor) => selectText(editor, 'bold')],
    ['several blocks', (editor) => selectText(editor, 'A heading', 'one line.')],
    ['a whole list', (editor) => selectText(editor, 'first item', 'third item')],
    ['part of a list item', (editor) => selectText(editor, 'item with more')],
    ['a task list', (editor) => selectText(editor, 'open task', 'done task')],
    ['a quote', (editor) => selectText(editor, 'A quote line.')],
    ['part of a line of code', (editor) => selectText(editor, 'a = 1')],
    ['a whole table', (editor) => selectCells(editor, 0, 5)],
    ['two cells of one row', (editor) => selectCells(editor, 2, 3)],
    ['a link', (editor) => selectText(editor, 'link')],
    ['Select All', (editor) => editor.editor.commands.selectAll()],
  ];
  for (const [name, select] of rows) {
    it(name, () => {
      const editor = editorWith(DOCUMENT);
      select(editor);
      const expected = wordsOnMain(editor);
      const { html } = copy(editor);
      expect(wordsOfCopy(editor.editor.view, html)).toBe(expected);
    });
  }
});

describe('the save runs through the function the copy runs through (#697)', () => {
  it('a document with kept HTML saves byte for byte', () => {
    const file =
      '# Kept\n\n<table>\n<tr><td>r1</td><td>r2</td></tr>\n</table>\n\n<details>\n<summary>More</summary>\n\nHidden text.\n\n</details>\n\n<div align="center">\n\n**centred**\n\n</div>\n\nTail.\n';
    const editor = editorWith(file);
    // The final line ending is the line conventions of the file, added by
    // `line-conventions.ts` when the file is written.
    expect(editor.getMarkdown()).toBe(file.replace(/\n$/, ''));
    expect(markdownOf(editor.editor.state)).toBe(editor.getMarkdown());
  });
});
