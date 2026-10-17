import type { Token } from 'marked';

/**
 * Where a `details` region of #563 ends (#604, K7b and K8 of the step zero,
 * owner decision 1 of 2026-10-17).
 *
 * The region of #563 was joined only from a start tag to an end tag standing
 * alone on its HTML block, with no other `details` between, and measured on
 * the step zero (comment 6236166181) three spellings of the corpus snapshot
 * fell outside it, each losing its `details` on an unedited save:
 *
 * - **the end tag sharing its HTML block with other tags**, `</p>` on the line
 *   above it or `<p></p>` on the line under it: 8 files (5 distinct);
 * - **the end tag sharing its HTML block with text under it**, which an HTML
 *   block takes up to the next blank line: 4 template files (4 distinct);
 * - **a `details` inside a `details`**: 1 file, the outer one lost.
 *
 * Each is now an end: an HTML block that opens with end tags, the last of
 * them `</details>`, and holds anything after, at the depth the region opened.
 * What follows the end tag in its block is drawn after the region's blocks,
 * as it was drawn before, and its bytes are part of the region.
 */

/** End tags, the last one `</details>`, opening a block: the end of a region. */
const END = /^(?:<\/[A-Za-z][A-Za-z0-9-]*\s*>\s*)*<\/details\s*>/i;

/** How many `details` a piece of markdown opens, less how many it ends. */
export function detailsDepth(raw: string): number {
  const opens = raw.match(/<details(?=[\s>])/gi)?.length ?? 0;
  const ends = raw.match(/<\/details\s*>/gi)?.length ?? 0;
  return opens - ends;
}

/**
 * The index of the block ending the region opened at `i`, or -1. The region
 * ends at depth one; a `details` opened and ended between counts in and out.
 */
export function closingDetails(tokens: readonly Token[], i: number): number {
  let depth = 1;
  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.type === 'html' && depth === 1 && END.test(token.raw.trim())) return j;
    depth += detailsDepth(token.raw);
    if (depth <= 0) return -1;
  }
  return -1;
}

/**
 * The blocks of a region, and after them what its last block holds past the
 * end tag, as the HTML block it was read as. Nothing is added where that is
 * white space.
 */
export function withClosingRest(inner: Token[], closing: Token): Token[] {
  const raw = closing.raw.trimStart();
  const end = END.exec(raw);
  const rest = end ? raw.slice(end[0].length).replace(/^[ \t]*\n/, '') : '';
  if (rest.trim() === '') return inner;
  const block = { type: 'html', block: true, pre: false, raw: rest, text: rest } as Token;
  return [...inner, block];
}

/** Whether bytes are one region: a `details` start tag first, every one opened ended. */
export function isOneRegion(text: string): boolean {
  const opens = text.match(/<details(?=[\s>])/gi)?.length ?? 0;
  return /^<details(?=[\s>])/i.test(text) && opens > 0 && detailsDepth(text) === 0;
}
