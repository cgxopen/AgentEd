/**
 * A block inside a table cell, written as inline HTML (#300).
 *
 * GFM gives a cell one line of inline content, and the editor lets a cell hold
 * blocks: an input rule, Enter, Shift+Enter, an Insert entry or a paste puts a
 * heading, a list, a task list, a blockquote, a fenced block, a second
 * paragraph or a hard break there. Until #300 `cellContent` wrote each in its
 * block spelling and flattened it onto the cell line, where it was read back as
 * text: **the block was gone on the next open**, and an ordered list went
 * without moving a byte, because its text is written the same way twice.
 *
 * Each is now written as the HTML element it is, which is the answer #278 gave
 * a table and #282 a rule. `marked` reads a tag on a cell line as inline HTML
 * and the text between two tags as markdown, so **the inline content inside
 * each block stays markdown** and only the block around it is HTML. Measured on
 * the step zero of #300 with `marked` 15.0.12 and `dompurify` 3.4.3: every
 * construct below comes back as the node it was, with its level, its start,
 * its checkboxes and its language, and GitHub and Obsidian both render it as
 * the construct, GitHub without the checkbox and without highlighting.
 *
 * A cell that holds nothing but paragraphs, rules and tables in the shapes
 * `cellContent` already wrote correctly does not come here, so what #278, #282
 * and #93 write is untouched.
 */

/** What the caller writes itself, so this module needs no turndown of its own. */
export interface CellWriters {
  /** The inline content of a paragraph or a heading, as markdown on one line. */
  readonly inline: (element: Element) => string;
  /** A table inside the cell, the way #278 writes it. */
  readonly table: (table: HTMLTableElement) => string;
}

/** The blocks that have no spelling on a cell line other than their HTML. */
const BLOCK_WITHOUT_INLINE_SPELLING = /^(H[1-6]|UL|OL|BLOCKQUOTE|PRE)$/;

/**
 * Whether a cell holds something `cellContent` cannot write as markdown: one of
 * the blocks above, or **two paragraphs side by side**, which a cell line can
 * only tell apart as `<p>`. A paragraph beside a rule or a table is not that
 * case; #282 and #278 write those.
 */
export function needsCellBlockSpelling(cell: Element): boolean {
  const children = Array.from(cell.children);
  return children.some(
    (child, index) =>
      BLOCK_WITHOUT_INLINE_SPELLING.test(child.nodeName.toUpperCase()) ||
      (isParagraph(child) && isParagraph(children[index - 1])),
  );
}

function isParagraph(element: Element | undefined): boolean {
  return element?.nodeName.toUpperCase() === 'P';
}

/**
 * The characters of a code block written as numeric or named entities.
 *
 * `marked` reads markdown inside `<code>` on a cell line, so a star, a backtick
 * or a bracket in the code would be read as syntax and leave the text; the
 * step zero measured `a *b*` coming back as `a b`. **This set is a list, and it
 * is witnessed by a sweep rather than argued**: `cell-blocks.test.ts` puts every
 * printable ASCII character, one at a time and all at once, in a code block in
 * a cell and reads it back as itself. Characters outside ASCII were not swept.
 * The pipe is not here, because `cellContent` escapes every pipe on the line.
 */
const CODE_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '*': '&#42;',
  _: '&#95;',
  '`': '&#96;',
  '[': '&#91;',
  ']': '&#93;',
  '\\': '&#92;',
  '~': '&#126;',
  ':': '&#58;',
  '@': '&#64;',
  '\n': '&#10;',
};

const CODE_ENTITY_PATTERN = /[&<>*_`[\]\\~:@\n]/g;

function codeText(text: string): string {
  return text.replace(CODE_ENTITY_PATTERN, (character) => CODE_ENTITIES[character]);
}

/** An attribute value, quoted, with the characters that would end it escaped. */
function attributeValue(value: string): string {
  return `"${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
}

/** Every block of a container, in order, on one line. */
export function cellBlocks(container: Element, writers: CellWriters): string {
  const children = Array.from(container.children);
  return children.map((child, index) => cellBlock(child, children[index - 1], writers)).join('');
}

function cellBlock(block: Element, before: Element | undefined, writers: CellWriters): string {
  const name = block.nodeName.toUpperCase();
  if (name === 'P') {
    // The first paragraph is the cell text it always was; one that follows
    // another paragraph needs its own element, or the two are one on reading.
    const text = writers.inline(block);
    return isParagraph(before) ? `<p>${text}</p>` : text;
  }
  if (/^H[1-6]$/.test(name)) {
    const tag = name.toLowerCase();
    return `<${tag}>${writers.inline(block)}</${tag}>`;
  }
  if (name === 'UL' || name === 'OL') return list(block, writers);
  if (name === 'BLOCKQUOTE') return `<blockquote>${cellBlocks(block, writers)}</blockquote>`;
  if (name === 'PRE') return codeBlock(block);
  if (name === 'HR') return '<hr>';
  if (name === 'TABLE') return writers.table(block as HTMLTableElement);
  // Nothing else is a block the schema lets a cell hold. Written as its inline
  // content rather than dropped, so an unforeseen element loses its shape and
  // keeps its words.
  return writers.inline(block);
}

function list(block: Element, writers: CellWriters): string {
  const tag = block.nodeName.toLowerCase();
  const start = tag === 'ol' ? block.getAttribute('start') : null;
  const opening = start !== null ? `<${tag} start=${attributeValue(start)}>` : `<${tag}>`;
  const items = Array.from(block.children).map((item) => listItem(item, writers));
  return `${opening}${items.join('')}</${tag}>`;
}

/**
 * A task item is written with a checkbox, which `parse.ts` turns back into the
 * task item it was (#160). Its blocks sit in the `div` the editor renders beside
 * the checkbox label; an ordinary item holds its blocks directly.
 */
function listItem(item: Element, writers: CellWriters): string {
  if (item.getAttribute('data-type') !== 'taskItem') {
    return `<li>${cellBlocks(item, writers)}</li>`;
  }
  const checked = item.getAttribute('data-checked') === 'true' ? ' checked' : '';
  const body = item.querySelector(':scope > div');
  return `<li><input type="checkbox"${checked}> ${body ? cellBlocks(body, writers) : ''}</li>`;
}

function codeBlock(block: Element): string {
  const code = block.querySelector('code');
  const language = Array.from(code?.classList ?? []).find((name) => name.startsWith('language-'));
  const opening = language ? `<code class=${attributeValue(language)}>` : '<code>';
  return `<pre>${opening}${codeText(code?.textContent ?? '')}</code></pre>`;
}
