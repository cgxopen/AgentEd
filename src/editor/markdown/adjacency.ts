/**
 * Two blocks the file wrote one directly under the other (#568).
 *
 * `# Title` on one line and a paragraph on the next are two blocks, and the
 * serializer used to write every pair of blocks a blank line apart: the
 * same rendering, other bytes, in 2667 of the 8706 files of the corpus the
 * step zero read. The adjacency is read here, while the file is parsed, and
 * rides on the block below as `data-adjacent`; `adjacency-save.ts` writes the
 * pair back without the blank line wherever it still reads as the same two
 * blocks.
 *
 * ── Where `marked` shows it ──
 *
 * After a paragraph, a list, a quote, a fence or a rule, a blank line is a
 * `space` token; after a heading, an indented code block, a table, an HTML
 * block or a definition, it is the end of that block's raw, which ends
 * `\n\n` there and `\n` when the next block is adjacent. One test covers
 * both, measured on the step zero for every pair of seventeen spellings at
 * the top level, in a quote and in a list item: no `space` token between the
 * two blocks, and no blank line at the end of the first one's raw.
 *
 * ── A run of blank lines (#590) ──
 *
 * The same two places hold a run of two or more blank lines, so the same
 * attribute carries its count: empty for no blank line, absent for one, a
 * number from 2 up for a run, written back as that many blank lines. A run
 * holding a line of spaces or tabs is left as before, written as one blank
 * line (owner decision E4 on #590). After a block whose bytes are kept, a
 * raw HTML block, only the line breaks after its last character are a gap:
 * its bytes already hold the lines of spaces at its end, and counting them
 * again made three files of the corpus move on the second save.
 *
 * ── Only a file ──
 *
 * A paste carries no flag, so pasted blocks are written a blank line apart
 * as they always were (owner decisions on #568): the marking runs only where
 * the parse keeps raw HTML, which is a file and never a paste.
 */
import type { Token, TokenizerAndRendererExtension } from 'marked';

/** The attribute a block written directly under another carries. */
export const ADJACENT_ATTRIBUTE = 'data-adjacent';

/** The longest run a block carries; a longer one is written with this many blank lines. */
export const MAX_RUN = 1000;

/** The element a mark token is drawn as, until `moveAdjacencyMarks` takes it. */
const MARK_ELEMENT = 'agented-adjacent';

const MARK_TOKEN = 'adjacentMark';

/** The deepest nesting of quotes and items this walks; past it, nothing is marked. */
const MAX_DEPTH = 64;

/** A raw that ends in a blank line, the second of the two places a gap lives. */
const ENDS_IN_A_BLANK_LINE = /\n[ \t]*\n[ \t\n]*$/;

/**
 * The tokens with a mark token before each block written directly under the
 * block before it, at every level a quote or a list item opens.
 *
 * A block of whitespace alone is never marked and never counts as the block
 * above: `marked` splits a trailing U+00A0 or U+2029 off a list into a
 * paragraph of whitespace, which the editor drops, and marking it made two
 * files of the corpus move on the second save in the step zero.
 */
export function markAdjacentBlocks(tokens: Token[], depth = 0): Token[] {
  if (depth > MAX_DEPTH) return tokens;
  const marked: Token[] = [];
  let above: Token | null = null;
  let between = '';
  for (const token of tokens) {
    if (token.type === 'space') {
      between += token.raw;
      marked.push(token);
      continue;
    }
    if (token.raw.trim() === '') {
      marked.push(token);
      continue;
    }
    if (above !== null) marked.push(...markBetween(above, between));
    between = '';
    markInside(token, depth);
    marked.push(token);
    above = token;
  }
  return marked;
}

/** The mark the gap between two blocks gets: none, the flag, or the count of a run. */
function markBetween(above: Token, between: string): Token[] {
  if (between === '' && !ENDS_IN_A_BLANK_LINE.test(above.raw)) {
    return [{ type: MARK_TOKEN, raw: '' } as unknown as Token];
  }
  const gap = gapOf(above) + between;
  if (/\n[ \t]+\n/.test(`\n${gap}`)) return [];
  const blankLines = (gap.match(/\n/g) ?? []).length - 1;
  return blankLines >= 2
    ? [{ type: MARK_TOKEN, raw: '', gap: blankLines } as unknown as Token]
    : [];
}

/** The end of the raw above that is a gap rather than bytes the block keeps. */
function gapOf(above: Token): string {
  const keepsItsBytes =
    above.type === 'html' || above.type === 'htmlWrapper' || above.type === 'htmlRegion';
  return (keepsItsBytes ? /\n*$/ : /[ \t\n]*$/).exec(above.raw)?.[0] ?? '';
}

/** The blocks a quote or a list item holds, marked in place. */
function markInside(token: Token, depth: number): void {
  if (token.type === 'blockquote') {
    token.tokens = markAdjacentBlocks(token.tokens ?? [], depth + 1);
  } else if (token.type === 'list') {
    for (const item of token.items) item.tokens = markAdjacentBlocks(item.tokens, depth + 1);
  }
}

/** The mark token, drawn as an empty element for `moveAdjacencyMarks`. */
export const adjacentMarkExtension: TokenizerAndRendererExtension = {
  name: MARK_TOKEN,
  level: 'block',
  renderer: (token) => {
    const gap = (token as unknown as { gap?: number }).gap;
    return gap === undefined
      ? `<${MARK_ELEMENT}></${MARK_ELEMENT}>`
      : `<${MARK_ELEMENT} data-gap="${gap}"></${MARK_ELEMENT}>`;
  },
};

/** The elements a block of the document is drawn as. */
const BLOCK = /^(?:P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|DIV|DETAILS)$/;

const isBlock = (node: Node | null): node is Element =>
  node !== null && node.nodeType === Node.ELEMENT_NODE && BLOCK.test(node.nodeName);

/**
 * `html` with each mark element taken out and its block below carrying the
 * attribute. In a tight list item the text after a block is bare, with no
 * element to carry it, so it is wrapped in the paragraph the editor makes of
 * it anyway. Bounded by the marks and by the children of their parents.
 */
export function moveAdjacencyMarks(html: string): string {
  if (!html.includes(MARK_ELEMENT)) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  for (const mark of Array.from(container.querySelectorAll(MARK_ELEMENT))) {
    let below = mark.nextSibling;
    while (below !== null && below.nodeType === Node.TEXT_NODE && !below.textContent?.trim()) {
      below = below.nextSibling;
    }
    if (isBlock(below)) {
      below.setAttribute(ADJACENT_ATTRIBUTE, mark.getAttribute('data-gap') ?? '');
    } else if (below !== null && mark.parentElement?.nodeName === 'LI') {
      wrapBareText(mark, below);
    }
    mark.remove();
  }
  return container.innerHTML;
}

/** The inline run from `first` to the next block, wrapped in a flagged paragraph. */
function wrapBareText(mark: Element, first: ChildNode): void {
  const paragraph = mark.ownerDocument.createElement('p');
  paragraph.setAttribute(ADJACENT_ATTRIBUTE, mark.getAttribute('data-gap') ?? '');
  mark.parentElement?.insertBefore(paragraph, first);
  let node: ChildNode | null = first;
  while (node !== null && !isBlock(node) && node.nodeName !== MARK_ELEMENT.toUpperCase()) {
    const next: ChildNode | null = node.nextSibling;
    paragraph.appendChild(node);
    node = next;
  }
}
