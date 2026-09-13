/**
 * A table the file wrote as raw HTML, kept as the bytes the file used (#283).
 *
 * GFM has one spelling for a table, and it holds less than HTML does. Until
 * #283 a document-level `<table>` was read into an ordinary table node and
 * written back as GFM on the first save, whether or not anything had been
 * edited. Measured on `2bf4f1a`, per construct: a `colspan` was flattened, a
 * `rowspan` moved a value into another column, alignment and the table's own
 * attributes were gone, a caption became a row, and a cell holding two
 * paragraphs or a list was flattened and then moved again on the second save.
 * Only the simplest table survived, and even that one turned its first data
 * cell into a header.
 *
 * **Owner decision of 2026-09-13, recorded on #283**: every document-level
 * HTML table that is not edited is written back as the bytes the file used;
 * an edited one is written as GFM, which is what happened before. A narrower
 * rule was measured beside it: keep a table only where GFM cannot hold it. It
 * was set aside because its line is drawn by a list of what GFM cannot hold,
 * and a construct the list does not name would still convert and lose on an
 * untouched save. This rule has no list.
 *
 * This file is the half that sees the file: which raw HTML is one whole table,
 * and how its bytes ride on the element `marked` builds. Deciding whether the
 * table is still the one the file wrote is the editor half, in
 * `kept-html-table.ts`, because only the document model can answer it.
 */

/** Where a table's source bytes ride between the parser and the table node. */
export const TABLE_HTML_SOURCE_ATTRIBUTE = 'data-table-html-source';

/**
 * Whether raw HTML is exactly one table: it opens a `<table>` tag and closes
 * with `</table>`, with nothing else around it but surrounding whitespace.
 *
 * `marked` ends an HTML block at a blank line, so a table with a blank line
 * inside it, or with text on the line after `</table>`, arrives as a token
 * that fails this test. Such a table is read as before and written as GFM;
 * the boundary is recorded in REQUIREMENTS with the rest of the rule.
 *
 * Both ends are anchored, so this is a check on two short slices of the
 * string and no backtracking can come from what sits between them.
 */
export function isWholeHtmlTable(raw: string): boolean {
  const text = raw.trim();
  return /^<table[\s>]/i.test(text) && /<\/table>$/i.test(text);
}

/**
 * `html` with the source stamped onto its opening `<table>` tag, or `null`
 * when `raw` is not one whole table.
 *
 * The attribute goes **first** in the tag. A file that spells its own
 * `data-table-html-source` therefore cannot choose what is kept: an HTML
 * parser keeps the first of two attributes with one name and drops the rest.
 *
 * Trailing newlines are not part of the table. The serializer spaces blocks
 * itself, as it does for every other block.
 */
export function stampTableSource(html: string, raw: string): string | null {
  if (!isWholeHtmlTable(raw)) return null;
  const source = encodeURIComponent(raw.replace(/\n+$/, ''));
  return html.replace(/<table(?=[\s>])/i, `<table ${TABLE_HTML_SOURCE_ATTRIBUTE}="${source}"`);
}

/**
 * The source bytes carried by an attribute value, or `null` when there are
 * none or they are not one whole table.
 *
 * The value is `encodeURIComponent` output, so it holds no `<`, `>`, `&` or
 * `"`. It cannot end the attribute or open an element. A value that does not
 * decode is refused rather than half-read; refusing it costs the table its
 * kept bytes and nothing else, since it is then written as GFM.
 */
export function decodeTableSource(value: string | null): string | null {
  if (value === null || value === '') return null;
  try {
    const decoded = decodeURIComponent(value);
    return isWholeHtmlTable(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
