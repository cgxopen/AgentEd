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

/** A separator cell can only ever be dashes, alignment colons and spaces. */
const SAFE_SEPARATOR_CELL = /^ ?:?-{1,200}:? ?$/;

/**
 * Read a style back off a table node.
 *
 * Everything is validated rather than trusted: the attribute travels through
 * the document model and through the clipboard, and a separator cell is
 * written into the file verbatim, so anything that is not dashes, colons and
 * spaces — or a width that is not a small whole number — is refused and the
 * table falls back to the default spelling. A document that carried its own
 * `data-table-style` in raw HTML cannot reach this: `attachTableStyles`
 * strips the attribute before writing the detected one.
 */
export function decodeTableStyle(value: string | null): TableStyle | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Not silent: a table whose style cannot be read is written in the
    // default spelling, and the reason is said out loud rather than guessed
    // at later from a diff.
    console.warn('[agented] unreadable table style, using the default spelling');
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { columns, emptyCell } = parsed as { columns?: unknown; emptyCell?: unknown };
  if (!Array.isArray(columns) || columns.length > 200) return null;
  const safe: ColumnStyle[] = [];
  for (const column of columns) {
    if (typeof column !== 'object' || column === null) return null;
    const { kind, width, separator } = column as Record<string, unknown>;
    if (kind !== 'hug' && kind !== 'fixed') return null;
    if (typeof width !== 'number' || !Number.isInteger(width) || width < 0 || width > 500) {
      return null;
    }
    if (typeof separator !== 'string' || !SAFE_SEPARATOR_CELL.test(separator)) return null;
    safe.push({ kind, width, separator });
  }
  if (emptyCell !== null && emptyCell !== undefined && emptyCell !== ' ') return null;
  return { columns: safe, emptyCell: emptyCell === ' ' ? ' ' : null };
}

function encodeTableStyle(style: TableStyle): string {
  return JSON.stringify(style);
}

/**
 * Put each detected spelling on the table it belongs to, in document order.
 *
 * Both lists come from the same markdown, so they agree in order and in
 * length. If they do not — a table shape this scanner reads differently from
 * `marked` — **nothing** is attached and every table falls back to the
 * default spelling: a mismatched list would give a table another table's
 * widths, which is worse than writing them all plainly.
 */
export function attachTableStyles(html: string, markdown: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const tables = container.querySelectorAll('table');
  // Only detection may set this attribute: a document carrying one in raw
  // HTML would otherwise choose how its own table is written.
  for (const table of tables) table.removeAttribute(TABLE_STYLE_ATTRIBUTE);
  if (tables.length === 0) return html;

  const styles = detectTableStyles(markdown);
  if (styles.length !== tables.length) return container.innerHTML;

  tables.forEach((table, index) => {
    table.setAttribute(TABLE_STYLE_ATTRIBUTE, encodeTableStyle(styles[index]));
  });
  return container.innerHTML;
}
