import type { MarkedExtension, Tokenizer, Tokens } from 'marked';

/**
 * A table row split into cells the way GFM splits it (#665).
 *
 * GFM takes a pipe with a backslash right before it as content of the cell,
 * whatever stands before that backslash, and takes the backslash off before
 * the cell is read as inline markdown. `marked` 15 decides by counting the
 * backslashes instead: after an even run, two or four, the pipe ends the
 * cell. Measured on the step zero of #665 against cmark-gfm, which GitHub
 * uses: a body cell a file spelled `x\\|y` was split there, and the save
 * wrote the halves and dropped the next cell; a code span typed with one
 * backslash before a pipe, which the writer spells with two, reopened as no
 * table at all. Every run of one or three read the same in both.
 *
 * So the table tokenizer of `marked` 15.0.12 is restated below with the one
 * change, in the cell split, and registered from `parse.ts`. Everything else,
 * the pattern that finds a table, the alignment and the inline reading of a
 * cell, is the library's, and `table-cells.test.ts` pins the tokens against
 * a pristine `Marked` on every shape where the two rules agree, so an upgrade
 * of `marked` that drifts shows there.
 *
 * The writer needs nothing: the cell escape of `serialize.ts` writes what
 * cmark-gfm reads, measured on every shape of the step zero.
 */

/**
 * Whether the pipe at `index` of `row` ends a cell: it does unless a
 * backslash stands right before it. The one rule `splitRow` of
 * `table-style.ts` uses too, so the spelling of a table and its cells are
 * read the same way.
 */
export function pipeEndsCell(row: string, index: number): boolean {
  return row[index] === '|' && row[index - 1] !== '\\';
}

/**
 * The cells of one row, trimmed, an escaped pipe written as a pipe: the
 * `splitCells` of `marked` with `pipeEndsCell` as its boundary. `count` pads
 * or cuts a body row to the width of the header, as the library does.
 */
export function gfmCells(row: string, count?: number): string[] {
  const spaced = row.replace(/\|/g, (pipe, offset: number) =>
    pipeEndsCell(row, offset) ? ' |' : pipe,
  );
  const cells = spaced.split(/ \|/);
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells.at(-1)?.trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** The alignment a delimiter cell asks for, read by the patterns of `marked`. */
function alignOf(rules: Tokenizer['rules'], cell: string): Tokens.Table['align'][number] {
  if (rules.other.tableAlignRight.test(cell)) return 'right';
  if (rules.other.tableAlignCenter.test(cell)) return 'center';
  if (rules.other.tableAlignLeft.test(cell)) return 'left';
  return null;
}

/** The table tokenizer of `marked` 15.0.12, its cells split by `gfmCells`. */
function table(this: Tokenizer, src: string): Tokens.Table | undefined {
  const cap = this.rules.block.table.exec(src);
  if (!cap || !this.rules.other.tableDelimiter.test(cap[2])) return undefined;
  const headers = gfmCells(cap[1]);
  const aligns = cap[2].replace(this.rules.other.tableAlignChars, '').split('|');
  if (headers.length !== aligns.length) return undefined;
  const rows = cap[3]?.trim()
    ? cap[3].replace(this.rules.other.tableRowBlankLine, '').split('\n')
    : [];
  const align = aligns.map((cell) => alignOf(this.rules, cell));
  const cell = (text: string, i: number, header: boolean): Tokens.TableCell => ({
    text,
    tokens: this.lexer.inline(text),
    header,
    align: align[i],
  });
  return {
    type: 'table',
    raw: cap[0],
    align,
    header: headers.map((text, i) => cell(text, i, true)),
    rows: rows.map((row) => gfmCells(row, headers.length).map((text, i) => cell(text, i, false))),
  };
}

/** The override `parse.ts` registers. */
export const gfmTableExtension: MarkedExtension = { tokenizer: { table } };
