/**
 * How a table was spelled in the file it came from (#93).
 *
 * A GFM table can be written many ways that all render identically: cells
 * hugged by one space (`| a | b |`) or padded so the pipes line up, a
 * separator spaced (`| --- |`) or tight (`|---|`), its dashes fixed at three
 * or filled to the column's width, an empty cell as `| |` or `|  |`. AgentEd
 * used to write exactly one of those spellings — padded, spaced, dashes to
 * the width — on every table of every document, which rewrote 628 of the 630
 * bytes by which an untouched save grew `README.md` (R-C2).
 *
 * **The spelling is a property of the file, like its line endings** (#79/#86),
 * and it is destroyed before the HTML exists: `marked` trims every cell, so
 * `| a    | b |` and `| a | b |` reach the serializer as the same `<td>a</td>`.
 * It therefore has to be read from the raw markdown, at the moment AgentEd
 * learns what the document contains.
 *
 * **It is carried per table, on the table itself.** Measured over 1628 tables
 * in 758 files on this machine: a per-table descriptor holding each column's
 * width reproduces 91% of them byte-exactly, while one style per document
 * with widths recomputed from the content reproduces 76% — and a recomputed
 * width fails the case this issue is about, a file whose author padded a
 * column wider than its content needs. Carrying an ordered list of styles on
 * the document was rejected for a different reason: inserting one table
 * shifts the mapping, and a table the user never touched would be rewritten
 * in another table's spelling — the very defect being fixed here. Riding on
 * the node has no such failure: a table and its spelling move together
 * through editing, Save As and copy-paste, and nothing can half-wire them.
 *
 * ── Read from the renderer, so there is nothing to pair (#200) ──
 *
 * This used to scan every table of the document into an array and pair that
 * array with `querySelectorAll('table')` by document order, writing nothing
 * at all when the two counts disagreed. The refusal was correct — a table
 * given another table's widths is worse than a table written plainly — and
 * it was silent, and it cost the **whole document** rather than the one
 * table it could not place.
 *
 * Two documents reach it, and the second is the one worth naming. A
 * hand-written `<table>` is emitted by `marked` as an `html` token, so the
 * scan misses what `querySelectorAll` finds. And a table **inside a
 * blockquote** has lines that open with a quote marker, which
 * `findTableBlocks` does not read past, so the scan finds nothing at all
 * where `marked` produces a `table` token — ordinary markdown, no raw HTML
 * anywhere. Measured at the editor level: a padded table beside a quoted one
 * went 97 bytes in and 82 out, its alignment gone.
 *
 * There is nothing to pair now. `marked` hands its table renderer the token
 * for the table it is rendering, and that token carries the `raw` of that
 * table with any quote markers already stripped — so the bytes and the
 * element are the same thing. The same route `blockquote-spacing.ts` takes
 * for #199 and `list-spacing.ts` for #28. It also reads *more* than the scan
 * did: compared over ten table shapes and the seven documents of this
 * repository, the two agree on sixteen of seventeen, and the one difference
 * is the quoted table, where the per-token reading is the correct one and
 * the whole-document scan produces nothing.
 *
 * A table that reaches the HTML without passing this renderer — one the file
 * wrote as raw HTML — is left with no attribute and falls back to the
 * default spelling. That is the same answer it got before, and now it is the
 * answer for that table alone.
 */

/** How one column is spelled. */
export interface ColumnStyle {
  /**
   * `hug`: one space each side of the content, whatever its length.
   * `fixed`: the content padded out to `width` — the file's own column width,
   * which is not always what the content needs.
   */
  readonly kind: 'hug' | 'fixed';
  /**
   * The number of characters between the pipes. For a `fixed` column it is
   * the column's width; for a `hug` column it is the *header* cell's width,
   * kept as the reference the separator is compared against.
   */
  readonly width: number;
  /** The separator cell for this column, exactly as the file spelled it. */
  readonly separator: string;
}

export interface TableStyle {
  readonly columns: readonly ColumnStyle[];
  /**
   * How the file spelled an empty cell, when it had one. `| |` and `|  |`
   * both render as nothing; the second is what hugging produces on its own,
   * so only the first has to be remembered.
   */
  readonly emptyCell: string | null;
}

/**
 * What a table with no spelling of its own is written with: cells hugged, a
 * spaced three-dash separator. Owner decision, 2026-08-24 — measured as what
 * 86% of the 1455 describable tables in the corpus use, what both tables in
 * this repository use, and what the one table AgentEd itself ships (the
 * *project document* template) uses. It also keeps a later edit's diff to the
 * line that changed, where a padded table re-aligns every row whenever its
 * widest cell moves.
 *
 * It applies to one case only: a table created in a document that holds no
 * other table to inherit from. A table read from a file — or from a template,
 * or from the clipboard — arrives with its own spelling.
 */
export const DEFAULT_TABLE_STYLE: TableStyle = { columns: [], emptyCell: null };

/** The attribute the style rides on, between the parser and the serializer. */
export const TABLE_STYLE_ATTRIBUTE = 'data-table-style';

const FENCE = /^\s*(```|~~~)/;
/** A separator row: pipes, dashes, optional alignment colons, spaces. */
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Split one table row into the raw text between its pipes — the padding is
 * the point, so nothing is trimmed. A `\|` is content, not a boundary.
 */
function splitRow(line: string): string[] {
  const text = line.trim();
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      current += '\\|';
      i++;
      continue;
    }
    if (text[i] === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += text[i];
  }
  cells.push(current);
  // The outer pipes produce an empty first and last piece; drop them.
  if (text.startsWith('|')) cells.shift();
  if (text.endsWith('|') && text.length > 1) cells.pop();
  return cells;
}

/** Every table block in `markdown`, in document order, as raw lines. */
function findTableBlocks(markdown: string): string[][] {
  const lines = markdown.split('\n');
  const blocks: string[][] = [];
  let inFence = false;
  // One pass over the lines, no lookahead beyond the next line and no
  // recursion: the scan is bounded by the document's length.
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const next = lines[i + 1];
    if (!lines[i].includes('|') || next === undefined) continue;
    if (!next.includes('|') || !SEPARATOR.test(next)) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].includes('|') && lines[end].trim().length > 0) end++;
    blocks.push(lines.slice(i, end));
    i = end - 1;
  }
  return blocks;
}

/**
 * Read one table block's spelling.
 *
 * A column is `fixed` when every one of its cells is the same width and each
 * is the content padded on the right — that is what a hand-aligned table
 * looks like. Anything else is `hug`, which is also the answer for a column
 * whose rows disagree with each other: such a table is written in the
 * spelling most of it uses and then holds still, rather than being preserved
 * character for character (recorded in R-C2).
 */
function readStyle(block: string[]): TableStyle {
  const rows = block.map(splitRow);
  const [header, separator, ...body] = rows;
  const data = [header, ...body];
  const columnCount = header.length;
  const columns: ColumnStyle[] = [];
  let emptyCell: string | null = null;

  for (let k = 0; k < columnCount; k++) {
    const cells = data.map((row) => row[k]).filter((cell) => cell !== undefined);
    // Uniform: every cell the same width, content left, spaces right — the
    // shape of a hand-aligned column. Padded: at least one cell has more
    // than the single space hugging would give it, which is what tells the
    // two apart when a column's contents happen to be equally long.
    const uniform = cells.every(
      (cell) =>
        cell.length === cells[0].length && cell === ` ${cell.trim().padEnd(cell.length - 2)} `,
    );
    const padded = cells.some((cell) => cell.trim().length + 2 < cell.length);
    const fixed = uniform && padded;
    // `|  |` is what hugging an empty cell produces by itself; only the
    // shorter spelling has to be remembered.
    if (cells.some((cell) => cell === ' ')) emptyCell = ' ';
    columns.push({
      kind: fixed ? 'fixed' : 'hug',
      width: header[k]?.length ?? 0,
      separator: separator[k] ?? ' --- ',
    });
  }
  return { columns, emptyCell };
}

/** The spelling of every table in `markdown`, in document order. */
export function detectTableStyles(markdown: string): TableStyle[] {
  return findTableBlocks(markdown).map(readStyle);
}

/** The widest column this will carry. Wider than any table a person writes. */
const MAX_COLUMN_WIDTH = 500;

/**
 * The longest separator cell this will carry, and the bound on the pattern
 * below — which is why that pattern needs no quantifier bound of its own: the
 * length is checked first, on a plain string comparison.
 *
 * Comfortably above `MAX_COLUMN_WIDTH` on purpose, rather than equal to it. A
 * separator cell's length comes from the *separator row*, while a column's
 * width comes from the *header row*, and the two need not agree — measured: a
 * 250-wide aligned column whose separator row was two characters out produced
 * a 254-character separator against a width of 252. Deriving one bound from
 * the other would refuse a style the detector had just produced whenever they
 * diverged, which is the defect this pair of bounds was tightened to remove.
 */
const MAX_SEPARATOR_CELL = 1000;

/**
 * A separator cell can only ever be dashes, alignment colons and spaces.
 *
 * **The spaces are unbounded on both sides, deliberately.** A hand-aligned
 * table whose author left `---` alone gives a separator cell that is mostly
 * spaces — `" ---     "` for a column of width 9 — and `readStyle` reads that
 * correctly. An earlier form of this pattern allowed one space each side, so
 * it refused a spelling the detector had just produced, and the table lost its
 * alignment on the first untouched save (#93, found in review). The two halves
 * of this module have to agree on what a legal style is, and
 * `table-style.test.ts` pins that as a property: anything `detectTableStyles`
 * can produce, `decodeTableStyle` must accept.
 */
const SAFE_SEPARATOR_CELL = /^ *:?-+:? *$/;

/** Whether a separator cell is safe to write into the user's file verbatim. */
function isSafeSeparatorCell(cell: string): boolean {
  // Length first: it keeps the scan over untrusted input explicitly bounded
  // without a quantifier bound inside the pattern, where it would have to be
  // kept in step with the width limit by hand. An earlier form bounded the
  // dashes at 200 inside the pattern, and a 250-wide aligned column with its
  // dashes filled to the width produced 252 — refused, and the table lost its
  // alignment. Same defect as the spaces, one dimension over.
  return cell.length <= MAX_SEPARATOR_CELL && SAFE_SEPARATOR_CELL.test(cell);
}

/** More columns than any table has; a longer list is not a style. */
const MAX_COLUMNS = 200;

/**
 * Say what was refused and fall back to the default spelling.
 *
 * Every rejection below goes through here rather than returning `null`
 * directly: a table quietly losing its spelling is exactly the defect #93 is
 * about, and before review one of these paths was silent — the only
 * `console.warn` covered a `JSON.parse` failure, so a *validation* refusal
 * left nothing behind but a diff to work backwards from.
 */
function refuse(reason: string): null {
  console.warn(`[agented] table style refused (${reason}); using the default spelling`);
  return null;
}

/**
 * Read a style back off a table node.
 *
 * Everything is validated rather than trusted: the attribute travels through
 * the document model and through the clipboard, and a separator cell is
 * written into the file verbatim, so anything that is not dashes, colons and
 * spaces — or a width that is not a small whole number — is refused and the
 * table falls back to the default spelling. A document that carries its own
 * `data-table-style` on a raw HTML table **does** reach this, since #200
 * removed `attachTableStyles` and the strip it made, and this validation is
 * what bounds what it can say — see the note above the sanitize call in
 * `parse.ts`.
 *
 * **A refusal is per table, not per column, and that is deliberate.** Refusing
 * only the offending column and keeping the rest was considered: it is the
 * proportionate answer when a failure is genuinely local. This one is not. A
 * separator cell that fails validation says nothing about whether the *widths*
 * beside it are right, and the widths are what alignment is made of — so
 * trusting half of a descriptor this function has just judged untrustworthy
 * produces a table aligned by unverified numbers with one column hugged: the
 * half-aligned table that is itself the harm #93 exists to prevent, and it
 * would look deliberate. Falling back whole gives a coherent, valid spelling
 * of the same table.
 *
 * That argument only holds because a refusal now means **corruption**, not a
 * shape the detector produces: the property test in `table-style.test.ts`
 * guarantees the two halves agree, which is what removes the case where
 * refusing per table cost an ordinary file its alignment.
 */
export function decodeTableStyle(value: string | null): TableStyle | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return refuse('a style that is not readable JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) return refuse('a style that is not an object');
  const { columns, emptyCell } = parsed as { columns?: unknown; emptyCell?: unknown };
  if (!Array.isArray(columns) || columns.length > MAX_COLUMNS) {
    return refuse('a column list that is missing or longer than a table can be');
  }
  const safe: ColumnStyle[] = [];
  for (const column of columns) {
    if (typeof column !== 'object' || column === null) {
      return refuse('a column that is not an object');
    }
    const { kind, width, separator } = column as Record<string, unknown>;
    if (kind !== 'hug' && kind !== 'fixed') return refuse('a column of an unknown kind');
    if (
      typeof width !== 'number' ||
      !Number.isInteger(width) ||
      width < 0 ||
      width > MAX_COLUMN_WIDTH
    ) {
      return refuse('a column width outside the range a table can have');
    }
    if (typeof separator !== 'string' || !isSafeSeparatorCell(separator)) {
      return refuse('a separator cell holding something other than dashes, colons and spaces');
    }
    safe.push({ kind, width, separator });
  }
  if (emptyCell !== null && emptyCell !== undefined && emptyCell !== ' ') {
    return refuse('an empty-cell spelling this cannot write');
  }
  return { columns: safe, emptyCell: emptyCell === ' ' ? ' ' : null };
}

function encodeTableStyle(style: TableStyle): string {
  return JSON.stringify(style);
}

/**
 * The characters that would end the attribute or open an element.
 *
 * The encoded style holds only the first of them today — a separator cell is
 * dashes, colons and spaces, a kind is one of two words, a width is a number
 * — and the escape covers all four rather than that one, because the
 * question is not which characters appear today but which ones can be
 * written into an HTML attribute. Same argument as the alt escape in
 * `parse.ts`, one file over.
 */
const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeForAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ATTRIBUTE_ESCAPES[ch] ?? ch);
}

/**
 * The attribute to write on this table, as a string ready for the tag, read
 * from the `raw` of the token `marked` is rendering.
 *
 * The scan is the same one the whole document used to go through; it is
 * given one table at a time now, so it finds one block. Where it does not —
 * a shape this scanner reads differently from `marked` — **nothing** is
 * written and this table falls back to the default spelling. That refusal is
 * still here and still silent, and what changed is how much it costs: one
 * table now, rather than every table in the document (#200).
 */
export function tableStyleAttribute(raw: string): string {
  const styles = detectTableStyles(raw);
  if (styles.length !== 1) return '';
  return ` ${TABLE_STYLE_ATTRIBUTE}="${escapeForAttribute(encodeTableStyle(styles[0]))}"`;
}
