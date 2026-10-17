import type { Token } from 'marked';
import { withBytesOnFirstBlock } from './kept-block-stamp';

/**
 * A raw `dl` kept as its bytes while untouched (#604, head 2, owner decision 2
 * of 2026-10-17, comment 6237588085).
 *
 * ── What was lost ──
 *
 * The schema has no node for `dl`, `dt` or `dd`. Each of their tags became an
 * inert carrier of #563 while the links between them stayed live, so a raw
 * `dl` was written as one paragraph of markdown links inside an HTML block,
 * where GitHub reads no link, and the second save escaped the brackets.
 * Measured on the step zero (comment 6236166181), 5 files (3 distinct) of the
 * corpus snapshot, all moving on the second save; a `code` holding HTML
 * inside such a `dl` was written as markdown too, 3 files (2 distinct).
 *
 * ── The route ──
 *
 * The one #563 gives a `details` held over several blocks. An HTML block
 * holding a `dl` start tag is joined with the blocks after it up to the one
 * whose end tag ends that `dl`, a `dl` ending in its own block being a region
 * of one block. The blocks are drawn as they were drawn before, and the first
 * of them carries the bytes of all of them. At save `kept-html-table.ts`
 * reads the bytes again and writes them where they give the blocks the
 * editor holds; an edit lets them go, option i of #468, and an undo brings
 * them back.
 *
 * The region starts at the block holding the start tag, whatever stands
 * before the tag in that block, so no block of the region begins with a
 * carrier left over from another: where the first block is a heading or a
 * paragraph, it is the one stamped. Only where it begins with inline content,
 * text or carriers, is that content put into a paragraph of its own, the
 * paragraph the editor draws for it already.
 */

/** The token the blocks of one `dl` are joined into. */
export interface DlRegionToken {
  readonly type: 'htmlDlRegion';
  readonly raw: string;
  readonly inner: Token[];
}

/** How many blocks one region may span; past it the blocks are left as they are. */
const MAX_BLOCKS = 10000;

/** How many `dl` a piece of markdown opens, less how many it ends. */
function dlDepth(raw: string): number {
  const opens = raw.match(/<dl(?=[\s>])/gi)?.length ?? 0;
  const ends = raw.match(/<\/dl\s*>/gi)?.length ?? 0;
  return opens - ends;
}

/** Whether `raw` holds a `dl` start tag. */
function holdsDl(raw: string): boolean {
  return /<dl(?=[\s>])/i.test(raw);
}

/** Whether bytes are one region of this route: a `dl` in them, every one opened ended. */
export function isDlRegion(text: string): boolean {
  return /^ {0,3}</.test(text) && holdsDl(text) && dlDepth(text) === 0;
}

/** The index of the block whose end tag ends the `dl` opened in block `i`, or -1. */
function closingDl(tokens: readonly Token[], i: number): number {
  let depth = dlDepth(tokens[i].raw);
  if (depth === 0) return i;
  for (let j = i + 1; j < tokens.length && j - i < MAX_BLOCKS; j++) {
    depth += dlDepth(tokens[j].raw);
    if (depth === 0) return tokens[j].type === 'html' ? j : -1;
    if (depth < 0) return -1;
  }
  return -1;
}

/** Join each raw `dl` into one region token, inside a quote and a list item too. */
export function joinDlRegions(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'blockquote' && token.tokens) token.tokens = joinDlRegions(token.tokens);
    if (token.type === 'list')
      for (const item of token.items) item.tokens = joinDlRegions(item.tokens);
    const end =
      token.type === 'html' && token.block && holdsDl(token.raw) && dlDepth(token.raw) >= 0
        ? closingDl(tokens, i)
        : -1;
    if (end < 0) {
      out.push(token);
      continue;
    }
    const inner = tokens.slice(i, end + 1);
    const region: DlRegionToken = {
      type: 'htmlDlRegion',
      raw: inner.map((t) => t.raw).join(''),
      inner,
    };
    out.push(region as unknown as Token);
    i = end;
  }
  return out;
}

/** The region as the editor reads it: its blocks as they render, the first carrying the bytes. */
export function dlRegionBlock(html: string, raw: string): string {
  return withBytesOnFirstBlock(html, raw, false);
}
