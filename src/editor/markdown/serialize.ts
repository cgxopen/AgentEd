import TurndownService from 'turndown';
import { getRelativePath } from '../image-registry';

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
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

// Preserve underline as <u> tag (not standard MD, but round-trips)
turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
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
