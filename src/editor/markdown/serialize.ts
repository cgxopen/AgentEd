import TurndownService from 'turndown';
import { getRelativePath } from '../image-registry';
import { createBlankReplacement } from './empty-fence';
import { createNarrowedEscape } from './escape';
import {
  type ColumnStyle,
  DEFAULT_TABLE_STYLE,
  decodeTableStyle,
  TABLE_STYLE_ATTRIBUTE,
  type TableStyle,
} from './table-style';

// ── An empty fenced block (#94) ──
//
// turndown replaces every blank node before it consults a rule, so an empty
// fenced block used to leave the file entirely — see `empty-fence.ts` for the
// mechanism and for why `addRule` cannot reach it. `blankReplacement` is the
// hook that can, and it is passed **at construction** because that is when
// the service resolves it into its rule table: assigning it afterwards has no
// effect, and this option is documented where `options.rules` below is not.
//
// The default is read off a service of turndown's own making rather than
// restated, so every blank node that is not a fenced block — an empty
// paragraph, an empty inline element, an empty list item — keeps behaving
// exactly as it does today, and goes on doing so if a future release changes
// what that means. Optional in the declaration, so the check is demanded
// rather than trusted: a release that stopped resolving a default would
// otherwise fail as `blankOtherwise is not a function` on the first save that
// meets an empty paragraph, rather than here, naming its cause.
const defaultBlankReplacement = new TurndownService().options.blankReplacement;
if (!defaultBlankReplacement) {
  throw new Error(
    'turndown no longer resolves a default options.blankReplacement, so an empty fenced block ' +
      'cannot delegate to it (#94). See src/editor/markdown/empty-fence.ts.',
  );
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  blankReplacement: createBlankReplacement(defaultBlankReplacement),
});

// #90: turndown escapes every `_` in a text node, because from one text node
// it cannot tell syntax from content. An intraword `_` is noise CommonMark
// never asked for, and it landed in the user's file on every save. The
// original method stays the authority on everything else — including every
// backtick; see `escape.ts` for why `*` and `` ` `` are deliberately not
// treated the same way.
turndown.escape = createNarrowedEscape(TurndownService.prototype.escape.bind(turndown));

// ── A number that begins a heading or a table cell (#97) ──
//
// Turndown's escape table holds `[/^(\d+)\. /g, '$1\\. ']`, so a text node
// beginning with digits and a full stop is written back with a backslash:
// `## 1. Product statement` was saved as `## 1\. Product statement`, on every
// save of every numbered document, in every diff (R-C2).
//
// **That escape matters exactly where a list can begin.** Measured on
// `marked@15` with `parse.ts`'s options: a heading and a table cell take
// inline content only, so `1. x` in either parses identically with or without
// the backslash — there it is noise. A paragraph, a blockquote body and a
// list-item body host block content, and there it is load-bearing:
// `1990. It was a good year.` without a backslash comes back as an ordered
// list starting at 1990, a sentence turned into a list. So the escape stays
// everywhere except the two contexts that know, by construction, that no list
// can start in them.
//
// This is why the fix is not a second narrowing in `escape.ts`: that function
// is handed one string and no node, so it cannot tell a heading's `1.` from a
// paragraph's. For the same reason it is not a pass over the finished
// markdown either — from the whole document those are the same characters.
// It has to be done where the context is already known.

/**
 * Drop the backslash turndown put in front of a leading `N.`, for a caller
 * that has already established a list cannot begin in it.
 *
 * Anchored to the start of the content because that is the only place the
 * escape can appear: turndown applies that rule at the start of a *text
 * node*, and in a heading or a cell parsed from a file, the leading text node
 * is the start of the content.
 *
 * A number that opens an **inline element** instead sits further in and keeps
 * its backslash — `## **1. Bold** thing`, `## *1. x* y`, `## [1. x](url) y`,
 * and the same three shapes inside a table cell. Rendering is identical and
 * the file holds still after the first save; it is recorded in R-C2 as a
 * known exception, with the constraint that decides it. Reaching those would
 * mean rewriting `N\.` anywhere in the string, which would corrupt the one
 * place those two characters are the user's own — inside a code span
 * (`` ## `1\. x` ``), whose text never reaches `escape` at all.
 */
function withoutLeadingListEscape(content: string): string {
  return content.replace(/^(\d+)\\\. /, '$1. ');
}

// The heading rule delegates to the built-in one — same filter, same output —
// and only changes the content handed to it. `headingStyle: 'atx'` and
// everything else that rule does stay turndown's business, exactly as
// `escape.ts` leaves the rest of the escape table to turndown.
//
// The parity with `escape.ts` is not exact in one respect: turndown documents
// overriding `TurndownService.prototype.escape`, but `options.rules` appears
// in neither of its README's option tables — it lives in the library's
// `defaults` and nowhere else, and the package ships no types, so TypeScript
// cannot see it change shape. Hence the guard: if a future release stops
// exposing the rule table, this fails at module load naming the cause, rather
// than as `Cannot read properties of undefined` from a blank application.
const builtinHeading = turndown.options.rules.heading;
if (!builtinHeading) {
  throw new Error(
    'turndown no longer exposes options.rules.heading, so the heading rule cannot delegate to the ' +
      'built-in one (#97). See the heading rule in src/editor/markdown/serialize.ts.',
  );
}
turndown.addRule('heading', {
  filter: builtinHeading.filter,
  replacement: (content, node, options) =>
    builtinHeading.replacement(withoutLeadingListEscape(content), node, options),
});

// Task list support
turndown.addRule('taskListItem', {
  filter: (node) => {
    return node.nodeName === 'LI' && node.parentElement?.getAttribute('data-type') === 'taskList';
  },
  replacement: (_content, node) => {
    const li = node as HTMLLIElement;
    const checkbox = li.querySelector('input[type="checkbox"]');
    const checked = checkbox?.hasAttribute('checked') ? 'x' : ' ';
    const textNode = li.querySelector('[data-node-view-content] p') || li.querySelector('p');
    const text = textNode?.textContent || _content.trim();
    return `- [${checked}] ${text}\n`;
  },
});

// ── List serialization ──
//
// Turndown's built-in rules pad every marker to a fixed width ("-   item",
// "1.  item") and, because TipTap wraps each item body in <p>, leave an
// indented blank line behind every item. Both rewrite list markup the user
// never touched, which breaks the R-C2 round-trip. The rules below emit the
// canonical single-space markers, honour the parent <ol start> so a list
// interrupted by a paragraph keeps its numbering (R-C1), and indent
// continuation lines by exactly the marker width, as CommonMark requires.

function isTaskListItem(node: Node): boolean {
  return (node as HTMLElement).parentElement?.getAttribute('data-type') === 'taskList';
}

/** Marker for one item: "- " for bullets, "N. " for ordered items. */
function listItemPrefix(li: HTMLElement, bulletMarker: string): string {
  const parent = li.parentElement;
  if (parent?.nodeName !== 'OL') return `${bulletMarker} `;
  const declared = Number.parseInt(parent.getAttribute('start') || '1', 10);
  const start = Number.isFinite(declared) ? declared : 1;
  const index = Array.prototype.indexOf.call(parent.children, li);
  return `${start + index}. `;
}

/** Indent every line but the first by the marker width; blank lines stay empty. */
function indentContinuation(body: string, width: number): string {
  const pad = ' '.repeat(width);
  return body
    .split('\n')
    .map((line, i) => (i === 0 || line.length === 0 ? line : pad + line))
    .join('\n');
}

// Explicitly excludes task list items so this rule cannot shadow the
// 'taskListItem' rule above — turndown gives precedence to the rule added
// last, so the two filters must not overlap.
turndown.addRule('listItem', {
  filter: (node) => node.nodeName === 'LI' && !isTaskListItem(node),
  replacement: (content, node, options) => {
    const prefix = listItemPrefix(node as HTMLElement, options.bulletListMarker ?? '-');
    const body = content.replace(/^\n+/, '').replace(/\s+$/, '');
    // An item holding more than one block is a loose item: CommonMark keeps
    // the blank line before the item that follows it.
    const separator = body.includes('\n\n') ? '\n\n' : '\n';
    return prefix + indentContinuation(body, prefix.length) + (node.nextSibling ? separator : '');
  },
});

// A paragraph inside a list item ends with a single newline when a nested
// list follows, so the nested list stays tight ("- one\n  - nested"); two
// paragraphs in the same item keep the blank line that separates them.
turndown.addRule('listItemParagraph', {
  filter: (node) => {
    const parent = node.parentElement;
    return node.nodeName === 'P' && parent?.nodeName === 'LI' && !isTaskListItem(parent);
  },
  replacement: (content, node) => {
    const next = (node as HTMLElement).nextElementSibling;
    const nestedListFollows = next?.nodeName === 'UL' || next?.nodeName === 'OL';
    return `\n\n${content}${next && !nestedListFollows ? '\n\n' : '\n'}`;
  },
});

// Preserve underline as <u> tag (not standard MD, but round-trips)
turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
});

// Strikethrough (#85). Turndown ships no rule for it, and its default for an
// element it does not recognise is to keep the text and drop the element — so
// `~~gone~~` was saved as `gone`, the only R-C2 exception that lost something
// the reader can see, and reachable from the floating toolbar's own S button.
// The filter covers both ends of the pipeline: `marked` (gfm) emits <del>,
// TipTap's Strike renders <s>, and <strike> is the legacy spelling its
// parseHTML also accepts. `~~` is GFM, the dialect the parser already runs.
// No overlap with the list, table or underline filters, so rule precedence
// (last one added wins) is not in play here.
turndown.addRule('strikethrough', {
  filter: ['s', 'del', 'strike'],
  replacement: (content) => `~~${content}~~`,
});

// Relativize image src via the registry at Turndown time.
// The node's src attribute is the exact string used to register the image,
// so the registry lookup is guaranteed to match (no intermediate normalization).
turndown.addRule('agentedImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const img = node as HTMLImageElement;
    const src = img.getAttribute('src') || '';
    const alt = img.getAttribute('alt') || '';
    const rel = getRelativePath(src);

    // Defensive: if src looks like our asset/blob URL but isn't in the registry,
    // log it — that would mean the registry has a bug, don't hide it.
    if (!rel && /^(http:\/\/asset\.localhost|blob:)/.test(src)) {
      console.warn('[agented] image src looks like asset URL but not in registry:', src);
    }

    return `![${alt}](${rel || src})`;
  },
});

// ── Table serialization (HTML table → GFM markdown table) ──

/**
 * Serialize a table cell's HTML to markdown.
 *
 * ⚠ Calls `turndown.turndown()` recursively from within a turndown rule.
 * This works only because the `tableSection` rule (see below) neutralizes
 * tr/th/td/thead/tbody/tfoot so they don't get serialized independently
 * by the recursive call. If you reorder rules or upgrade turndown, verify
 * tableSection still wins the rule match for table sub-elements.
 *
 * Newlines are flattened to spaces (MD tables are single-line) and
 * pipes are escaped to avoid breaking the column structure.
 *
 * A cell's own content is inline by the time it is written — GFM gives a cell
 * nothing else, and the newlines are flattened here anyway — so a leading
 * `N.` cannot open a list when the table is read back, and it is written
 * without turndown's backslash (#97). The recursive call above serializes the
 * cell as a paragraph, which is where that escape comes from.
 */
function cellContent(cell: HTMLElement): string {
  const inner = turndown.turndown(cell.innerHTML);
  const flattened = inner.replace(/\n/g, ' ').replace(/\|/g, '\\|').trim();
  return withoutLeadingListEscape(flattened);
}

// ── Writing a table the way the file wrote it (#93) ──
//
// AgentEd used to pad every cell of every table out to a uniform width,
// whatever the file had: 628 of the 630 bytes by which an untouched save grew
// `README.md`, and 488 of the 487 by which it grew `WORKFLOW.md` — the
// largest single term in "an untouched save rewrites the user's file" (R-C2).
// Minimal cells everywhere would have removed those bytes and moved the same
// exception onto every file whose author aligned a table by hand, so what is
// written now is what the file used: `table-style.ts` reads each table's
// spelling from the raw markdown on the way in, and the rules below apply it
// on the way out.
//
// **A carried width is a floor, not a size.** A cell the user edits past its
// column's width widens the column rather than breaking the alignment, and a
// column the user adds gets the width its content needs, in the table's own
// spelling. Preserving the source text verbatim would have no answer for
// either.

/** The cell text as it will be written, between the two pipes. */
function renderCell(
  content: string,
  column: ColumnStyle | undefined,
  width: number,
  emptyCell: string | null,
): string {
  // Hugging an empty cell gives `|  |` on its own; a file that wrote `| |`
  // gets `| |` back. A padded column pads its empty cells like any other.
  if (content.length === 0 && column?.kind !== 'fixed' && emptyCell === ' ') return ' ';
  const padded = column?.kind === 'fixed' ? content.padEnd(width) : content;
  return ` ${padded} `;
}

/**
 * The separator cell for one column.
 *
 * It is written back verbatim while the column above it is unchanged — which
 * is every table nobody edited, and the only way to keep a spelling this
 * varied: `| --- |`, `|---|`, `|:----|`, dashes filled to the width. It is
 * re-spelled only when the column's width has moved, and then in its own
 * spelling: the spaces it had, the alignment colons it had, and dashes that
 * follow the width only if they did before.
 */
function renderSeparator(column: ColumnStyle | undefined, headerWidth: number): string {
  const sample = column?.separator ?? ' --- ';
  // The comparison is against the *header* cell, because that is what a
  // separator is written to line up with — in a hugging column the rows below
  // are all different widths and none of them decides anything.
  if (column !== undefined && headerWidth === column.width) return sample;

  const spaced = sample.startsWith(' ') && sample.endsWith(' ');
  const core = sample.trim();
  const left = core.startsWith(':') ? ':' : '';
  const right = core.endsWith(':') ? ':' : '';
  const followedWidth = column !== undefined && sample.length === column.width;
  const marks = left.length + right.length;
  const dashes = followedWidth
    ? Math.max(3, headerWidth - (spaced ? 2 : 0) - marks)
    : Math.max(3, core.length - marks);
  const core2 = `${left}${'-'.repeat(dashes)}${right}`;
  return spaced ? ` ${core2} ` : core2;
}

function collectRows(table: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('th, td').forEach((cell) => {
      cells.push(cellContent(cell as HTMLElement));
    });
    rows.push(cells);
  });
  return rows;
}

/**
 * The width of each column: what the file used, never less than what the
 * content needs today. A column the style says nothing about — one the user
 * added — gets its content's width, which for a hugging column costs nothing.
 */
function columnWidths(rows: string[][], colCount: number, style: TableStyle): number[] {
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = 0;
    for (const row of rows) max = Math.max(max, (row[c] || '').length);
    const column = style.columns[c];
    widths.push(column?.kind === 'fixed' ? Math.max(column.width - 2, max) : max);
  }
  return widths;
}

function renderRow(row: string[], widths: number[], colCount: number, style: TableStyle): string[] {
  const cells: string[] = [];
  for (let c = 0; c < colCount; c++) {
    cells.push(renderCell(row[c] || '', style.columns[c], widths[c], style.emptyCell));
  }
  return cells;
}

const joinRow = (cells: string[]): string => `|${cells.join('|')}|`;

function formatMarkdownTable(rows: string[][], widths: number[], style: TableStyle): string {
  const colCount = widths.length;
  const header = renderRow(rows[0], widths, colCount, style);
  const lines: string[] = [joinRow(header)];

  // The separator, in the spelling the file used, measured against the header
  // cell it sits under.
  lines.push(joinRow(header.map((cell, c) => renderSeparator(style.columns[c], cell.length))));

  for (let r = 1; r < rows.length; r++) {
    lines.push(joinRow(renderRow(rows[r], widths, colCount, style)));
  }

  return `\n\n${lines.join('\n')}\n\n`;
}

/**
 * The spelling this table is written in: its own, or — for a table the user
 * created, which has none — the spelling of the first table in the document
 * that has one, so a document does not end up spelled two ways. With no table
 * to inherit from, `DEFAULT_TABLE_STYLE`.
 */
function styleFor(table: HTMLTableElement): TableStyle {
  const own = decodeTableStyle(table.getAttribute(TABLE_STYLE_ATTRIBUTE));
  if (own) return own;
  const sibling = table.ownerDocument?.querySelector(`table[${TABLE_STYLE_ATTRIBUTE}]`);
  return (
    decodeTableStyle(sibling?.getAttribute(TABLE_STYLE_ATTRIBUTE) ?? null) ?? DEFAULT_TABLE_STYLE
  );
}

turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    const rows = collectRows(table);
    if (rows.length === 0) return '';
    const colCount = Math.max(...rows.map((r) => r.length));
    const style = styleFor(table);
    return formatMarkdownTable(rows, columnWidths(rows, colCount, style), style);
  },
});

// Neutralize table sub-elements so they don't get serialized independently.
// Critical for the recursive turndown() call in cellContent (see above).
turndown.addRule('tableSection', {
  filter: ['thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
  replacement: () => '',
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
