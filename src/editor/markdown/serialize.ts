import TurndownService from 'turndown';
import { getRelativePath } from '../image-registry';
import { createNarrowedEscape } from './escape';

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
});

// #90: turndown escapes every `_` in a text node, because from one text node
// it cannot tell syntax from content. An intraword `_` is noise CommonMark
// never asked for, and it landed in the user's file on every save. The
// original method stays the authority on everything else — including every
// backtick; see `escape.ts` for why `*` and `` ` `` are deliberately not
// treated the same way.
turndown.escape = createNarrowedEscape(TurndownService.prototype.escape.bind(turndown));

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
 */
function cellContent(cell: HTMLElement): string {
  const inner = turndown.turndown(cell.innerHTML);
  return inner.replace(/\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function pad(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - str.length));
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

function calculateColumnWidths(rows: string[][], colCount: number): number[] {
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = 3; // minimum for separator ---
    for (const row of rows) {
      const len = (row[c] || '').length;
      if (len > max) max = len;
    }
    widths.push(max);
  }
  return widths;
}

function formatRow(row: string[], colWidths: number[], colCount: number): string {
  const cells = [];
  for (let c = 0; c < colCount; c++) {
    cells.push(pad(row[c] || '', colWidths[c]));
  }
  return `| ${cells.join(' | ')} |`;
}

function formatMarkdownTable(rows: string[][], colWidths: number[]): string {
  const colCount = colWidths.length;
  const lines: string[] = [];

  // Header (first row — GFM always requires a header)
  lines.push(formatRow(rows[0], colWidths, colCount));

  // Separator
  const sep = colWidths.map((w) => '-'.repeat(w));
  lines.push(`| ${sep.join(' | ')} |`);

  // Data rows
  for (let r = 1; r < rows.length; r++) {
    lines.push(formatRow(rows[r], colWidths, colCount));
  }

  return `\n\n${lines.join('\n')}\n\n`;
}

turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const rows = collectRows(node as HTMLTableElement);
    if (rows.length === 0) return '';
    const colCount = Math.max(...rows.map((r) => r.length));
    const colWidths = calculateColumnWidths(rows, colCount);
    return formatMarkdownTable(rows, colWidths);
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
