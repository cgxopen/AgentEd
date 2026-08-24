import { afterEach, describe, expect, it } from 'vitest';
import workflow from '../../docs/internal/WORKFLOW.md?raw';
import readme from '../../README.md?raw';
import { applyLineConventions, detectLineConventions } from '../formats/line-conventions';
import projectDocument from '../templates/project-document.md?raw';
import { createEditor, type EditorInstance } from './setup';

/**
 * #93 at the level the user meets it: open a document with a table, change
 * nothing, save — and the table should come back the way it was written
 * (R-C2).
 *
 * Measured on `087e232` through `createEditor` + `setMarkdown` +
 * `getMarkdown`: every table came back padded to uniform column widths,
 * whatever the file used. That was **628 of the 631 bytes** by which an
 * untouched save grew `README.md`, and **all 488** of `WORKFLOW.md`'s — the
 * largest single term in "an untouched save rewrites the user's file".
 *
 * The pair-level half is in `markdown/roundtrip.test.ts` and the descriptor
 * itself in `markdown/table-style.test.ts`. This file exists because the
 * blind spot #84 named is real — `roundtrip.test.ts` never builds an editor,
 * and every finding since #42 has come through the level it does not cover.
 * Here it covers something specific: the spelling rides on the table node
 * through TipTap's document model, which only an editor can exercise.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** What the save path writes: the serializer's text, with the file's own line conventions (#79). */
function savedFrom(source: string, editor: EditorInstance): string {
  return applyLineConventions(editor.getMarkdown(), detectLineConventions(source));
}

const tableLines = (text: string) => text.split('\n').filter((line) => /^\s*\|/.test(line));

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('a table is written the way the file wrote it (#93)', () => {
  it.each([
    ['hugged cells', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    [
      'a tight separator with fitted dashes',
      '| Shortcut | Action |\n|----------|--------|\n| `x` | y |',
    ],
    ['columns aligned to their content', '| a   | bb  |\n| --- | --- |\n| ccc | d   |'],
    [
      'columns padded wider than the content needs',
      '| a      | b      |\n| ------ | ------ |\n| c      | d      |',
    ],
    ['alignment markers', '| a | b |\n| :-- | --: |\n| 1 | 2 |'],
    ['the shorter spelling of an empty cell', '| | Does |\n| --- | --- |\n| **Owner** | Decides |'],
    [
      'inline formatting inside cells',
      '| **a** | `b` |\n| --- | --- |\n| [c](https://e.com) | d |',
    ],
    [
      'two tables spelled differently in one document',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntext\n\n| c   | d   |\n|-----|-----|\n| eee | fff |',
    ],
    // Found in review, and the ordinary way to write markdown by hand: align
    // the data, leave `---` alone. Detection read this correctly all along —
    // the validator refused it, so the whole table lost its alignment on the
    // first untouched save. The shape a reader will look for, kept beside the
    // property that guarantees the class.
    [
      'aligned columns whose separator row was left short',
      '| Name    | Age |\n| ---     | --- |\n| Ada     | 36  |',
    ],
    [
      'aligned columns whose short separator carries alignment colons',
      '| Name    | Age |\n|:---     |---: |\n| Ada     | 36  |',
    ],
  ])('leaves %s byte-identical', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('changes a table once at most: the second save moves nothing', () => {
    // The property from #96, on the shape this PR is about. A table the
    // implementation cannot hold exactly may be rewritten once — never twice.
    const ragged = '| a   | b   |\n| --- | --- |\n| c | d |';
    const first = editorWith(ragged).getMarkdown();
    const second = editorWith(first).getMarkdown();
    expect(second).toBe(first);
  });
});

describe('the spelling survives the document model, not just the text', () => {
  it('keeps it through an edit inside a cell', () => {
    const editor = editorWith('| a      | b      |\n| ------ | ------ |\n| c      | d      |');
    // Type into the first body cell: the column keeps its width, and only
    // that cell's content changes.
    editor.editor.commands.setTextSelection(editor.editor.state.doc.content.size - 6);
    editor.editor.commands.insertContent('X');
    const saved = editor.getMarkdown();
    expect(saved).toContain('| ------ | ------ |');
    expect(saved.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3);
  });

  it('widens a column when the content outgrows the width the file used', () => {
    // A carried width is a floor, not a size: the alignment is kept rather
    // than broken, and preserving the source text verbatim would have no
    // answer for this at all.
    const editor = editorWith('| a   | b   |\n| --- | --- |\n| c   | d   |');
    editor.editor.commands.setContent(
      '<table data-table-style="' +
        JSON.stringify({
          columns: [
            { kind: 'fixed', width: 5, separator: ' --- ' },
            { kind: 'fixed', width: 5, separator: ' --- ' },
          ],
          emptyCell: null,
        }).replace(/"/g, '&quot;') +
        '"><tbody><tr><th>a</th><th>b</th></tr><tr><td>cccccccc</td><td>d</td></tr></tbody></table>',
    );
    const saved = editor.getMarkdown().trim().split('\n');
    expect(saved[0]).toBe('| a        | b   |');
    expect(saved[2]).toBe('| cccccccc | d   |');
  });

  it('gives a table with no spelling of its own the one the document uses', () => {
    // A table the user creates in a document that already has one: the
    // document is not left spelled two ways. The second table below carries
    // no style attribute, which is exactly what a table made in the editor
    // looks like.
    const editor = editorWith('| Shortcut | Action |\n|----------|--------|\n| `x` | y |');
    const styled = editor.editor.getHTML();
    editor.editor.commands.setContent(
      `${styled}<p>text</p><table><tbody><tr><th>c</th><th>d</th></tr><tr><td>e</td><td>f</td></tr></tbody></table>`,
    );
    const separators = editor
      .getMarkdown()
      .split('\n')
      .filter((l) => /^\|[-: ]+\|/.test(l));
    expect(separators).toHaveLength(2);
    // The tight, fitted spelling of the first table, applied to the second.
    expect(separators[0]).toBe('|----------|--------|');
    expect(separators[1]).toBe('|---|---|');
  });

  it('writes a table created in an empty document with hugged cells', () => {
    // The default, and the only case it decides. Owner decision, 2026-08-24.
    const editor = editorWith('');
    editor.editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    const saved = editor.getMarkdown().trim().split('\n');
    expect(saved[1]).toBe('| --- | --- |');
    // `|  |` is what hugging an empty cell gives on its own — the spelling
    // the *project document* template already uses.
    expect(saved[0]).toBe('|  |  |');
  });
});

describe('three real documents, opened and saved unedited', () => {
  // The acceptance criterion, as an equality: zero bytes attributable to
  // tables. What remains in `README.md` is three bytes of #96's recorded
  // backtick exception, and the test says so rather than leaving the number
  // to be discovered.
  it.each([
    ['README.md', readme, 3],
    ['docs/internal/WORKFLOW.md', workflow, 0],
    ['src/templates/project-document.md', projectDocument, 0],
  ])('%s: no byte of the difference is a table', (_name, source, expectedRest) => {
    const saved = savedFrom(source, editorWith(source));
    const before = tableLines(source);
    const after = tableLines(saved);

    expect(after).toEqual(before);
    const tableBytes = after.join('\n').length - before.join('\n').length;
    expect(tableBytes).toBe(0);
    expect(saved.length - source.length).toBe(expectedRest);
  });

  it.each([
    ['README.md', readme],
    ['docs/internal/WORKFLOW.md', workflow],
    ['src/templates/project-document.md', projectDocument],
  ])('%s holds still on the second save', (_name, source) => {
    const first = savedFrom(source, editorWith(source));
    const second = savedFrom(first, editorWith(first));
    expect(second).toBe(first);
  });

  it('WORKFLOW.md is byte-identical, end to end', () => {
    // The whole point of the issue, on a real document: open, save nothing,
    // and the file has not changed at all. On `087e232` it grew by 488 bytes.
    expect(savedFrom(workflow, editorWith(workflow))).toBe(workflow);
  });
});
