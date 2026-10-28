import { Marked } from 'marked';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';
import { markdownToHtml } from './parse';
import { gfmTableExtension } from './table-cells';

/**
 * A table row is split into cells by the GFM rule (#665).
 *
 * The cells each row expects are what cmark-gfm, which GitHub uses, read from
 * the same input, measured outside the harness on the step zero of #665 and
 * written here. A cell is its text, prefixed `code:` where it is a code span.
 * The quote and the list item read as the top level in every shape there.
 */
const editors: EditorInstance[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(markdown);
  editors.push(editor);
  return editor;
}

/** The cells of the first table `html` holds, row by row. */
function cellsOf(html: string): string[][] {
  const template = document.createElement('template');
  template.innerHTML = html;
  const table = template.content.querySelector('table');
  if (!table) return [];
  return Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).map((cell) => {
      const text = (cell.textContent ?? '').trim();
      return cell.querySelector('code') ? `code:${text}` : text;
    }),
  );
}

type Kind = 'text' | 'code';
type Row = 'header' | 'body';

/** What cmark-gfm read, by backslashes before the pipe, kind of cell and row. */
const GFM: Record<string, string[][]> = {
  '0 text header': [],
  '0 text body': [
    ['h1', 'h2'],
    ['x', 'y'],
  ],
  '0 code header': [],
  '0 code body': [
    ['h1', 'h2'],
    ['`x', 'y`'],
  ],
  '1 text header': [
    ['x|y', 'h2'],
    ['a', 'b'],
  ],
  '1 text body': [
    ['h1', 'h2'],
    ['x|y', 'b'],
  ],
  '1 code header': [
    ['code:x|y', 'h2'],
    ['a', 'b'],
  ],
  '1 code body': [
    ['h1', 'h2'],
    ['code:x|y', 'b'],
  ],
  '2 text header': [
    ['x|y', 'h2'],
    ['a', 'b'],
  ],
  '2 text body': [
    ['h1', 'h2'],
    ['x|y', 'b'],
  ],
  '2 code header': [
    ['code:x\\|y', 'h2'],
    ['a', 'b'],
  ],
  '2 code body': [
    ['h1', 'h2'],
    ['code:x\\|y', 'b'],
  ],
  '3 text header': [
    ['x\\|y', 'h2'],
    ['a', 'b'],
  ],
  '3 text body': [
    ['h1', 'h2'],
    ['x\\|y', 'b'],
  ],
  '3 code header': [
    ['code:x\\\\|y', 'h2'],
    ['a', 'b'],
  ],
  '3 code body': [
    ['h1', 'h2'],
    ['code:x\\\\|y', 'b'],
  ],
};

/** The table of the sweep: `x`, `run` backslashes, a pipe, `y`, in one cell of `row`. */
function tableWith(run: number, kind: Kind, row: Row): string[] {
  const inner = `x${'\\'.repeat(run)}|y`;
  const cell = kind === 'text' ? inner : `\`${inner}\``;
  return row === 'header'
    ? [`| ${cell} | h2 |`, '| --- | --- |', '| a | b |']
    : ['| h1 | h2 |', '| --- | --- |', `| ${cell} | b |`];
}

const CONTAINERS: Record<string, (lines: string[]) => string> = {
  'at the top level': (lines) => `${lines.join('\n')}\n`,
  'in a quote': (lines) => `${lines.map((line) => `> ${line}`).join('\n')}\n`,
  'in a list item': (lines) =>
    `${lines.map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`)).join('\n')}\n`,
};

const SHAPES = [0, 1, 2, 3].flatMap((run) =>
  (['text', 'code'] as const).flatMap((kind) =>
    (['header', 'body'] as const).flatMap((row) =>
      Object.keys(CONTAINERS).map((container) => ({ run, kind, row, container })),
    ),
  ),
);

describe('a file: each cell read as GitHub reads it, and the save holding (#665)', () => {
  it.each(SHAPES)('$run backslashes, $kind cell, $row row, $container', (shape) => {
    const file = CONTAINERS[shape.container](tableWith(shape.run, shape.kind, shape.row));
    const expected = GFM[`${shape.run} ${shape.kind} ${shape.row}`];
    expect(cellsOf(markdownToHtml(file))).toEqual(expected);
    const saved = editorWith(file).getMarkdown();
    expect(cellsOf(markdownToHtml(saved))).toEqual(expected);
    expect(editorWith(saved).getMarkdown()).toBe(saved);
  });

  it('a text cell spelled with two backslashes before a pipe is written once with one', () => {
    const saved = editorWith('| h1 | h2 |\n| --- | --- |\n| x\\\\|y | b |\n').getMarkdown();
    expect(saved).toBe('| h1 | h2 |\n| --- | --- |\n| x\\|y | b |');
  });
});

/** Type `text` into the first cell of a new table, as text or as a code span, and save. */
function typedInACell(text: string, kind: Kind): string {
  const editor = editorWith('');
  editor.editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
  editor.editor.commands.insertContent({
    type: 'text',
    text,
    marks: kind === 'code' ? [{ type: 'code' }] : [],
  });
  return editor.getMarkdown();
}

describe('typed into a cell: read back as typed, and the save holding (#665)', () => {
  const TYPED = [0, 1, 2, 3].flatMap((run) =>
    (['text', 'code'] as const).map((kind) => ({ run, kind })),
  );
  it.each(TYPED)('$run backslashes before a pipe, $kind', ({ run, kind }) => {
    const text = `x${'\\'.repeat(run)}|y`;
    const saved = typedInACell(text, kind);
    expect(cellsOf(markdownToHtml(saved))[0][0]).toBe(kind === 'code' ? `code:${text}` : text);
    expect(editorWith(saved).getMarkdown()).toBe(saved);
  });
});

describe('a code span typed with an odd run before a pipe reopens as a table (#665)', () => {
  // The writer spells it with an even run, which `marked` 15 split there, so
  // the header row had a cell too many and the table reopened as a paragraph.
  it.each([1, 3])('%i backslashes', (run) => {
    const text = `x${'\\'.repeat(run)}|y`;
    const reopened = editorWith(typedInACell(text, 'code'));
    const table = reopened.editor.state.doc.firstChild;
    expect(table?.type.name).toBe('table');
    expect(table?.firstChild?.firstChild?.textContent).toBe(text);
  });
});

describe('the tokenizer gives the tokens of marked wherever the two rules agree (#665)', () => {
  /** The tokens of `markdown` read by `marked` with no configuration, or with this tokenizer alone. */
  const tokens = (markdown: string, withTokenizer: boolean) =>
    (withTokenizer
      ? new Marked({ gfm: true }).use(gfmTableExtension)
      : new Marked({ gfm: true })
    ).lexer(markdown);

  const AGREE = SHAPES.filter((shape) => shape.run !== 2).map((shape) => ({
    ...shape,
    markdown: CONTAINERS[shape.container](tableWith(shape.run, shape.kind, shape.row)),
  }));
  const RENDERER_SHAPES = [
    '| a | b |\n| --- | --- |\n| c | d |',
    '| head  | second |\n| ----- | ------ |\n| a     | b      |',
    '| a | b |\n| :-- | --: |\n| c | d |',
    '| a | b |\n| :-: | --- |\n| c |',
    '| a | b |\n| --- | --- |',
    '| **a** | `b` |\n| --- | --- |\n| [c](https://e.com) | d |',
    'a | b\n--- | ---\nc | d | e',
    '| a |\n| --- |\n| c |\n\n| x |\n| --- |\n| y |',
  ];

  it.each(AGREE)('$run backslashes, $kind cell, $row row, $container', ({ markdown }) => {
    expect(tokens(markdown, true)).toEqual(tokens(markdown, false));
  });

  it.each(RENDERER_SHAPES)('%j', (markdown) => {
    expect(tokens(markdown, true)).toEqual(tokens(markdown, false));
  });

  it('and they differ on an even run, where the rules do', () => {
    const markdown = CONTAINERS['at the top level'](tableWith(2, 'text', 'body'));
    expect(tokens(markdown, true)).not.toEqual(tokens(markdown, false));
  });
});
