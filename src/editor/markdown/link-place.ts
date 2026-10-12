import type { Token } from 'marked';

/**
 * Two links side by side with the same destination stay two (#565, owner
 * decision D5 on #565).
 *
 * The editor joins two neighbouring marks whose attributes are equal, so
 * `[a](/u)[b](/u)` was held as one link and written `[ab](/u)`, in any file:
 * a link nobody wrote, R-C13. #587 met the same join with the kept link and
 * gave each its place among the links of the parse; here a counter across
 * the document would not do, since every route that decides at save whether
 * kept bytes were edited reads them again and compares (#283, #461, #468,
 * #470, #563), and a counter gives the second read other numbers: measured
 * on the step zero of #565, 249 tests reddened.
 *
 * So a link takes the **parity of its place among the links of its block of
 * inline text**, a paragraph, a heading or a table cell, counted in reading
 * order through the marks around them, `*[a](/u)*[b](/u)` included. Two
 * links that touch are consecutive in that order, so they differ, and a
 * second read of the same block counts the same. Only the odd ones carry the
 * attribute, so a block with one link reads as before and a link the editor
 * makes, carrying none, is the even one.
 */

/** Set on a link whose place among the links of its block is odd. Stamped (#447). */
export const LINK_PLACE_ATTRIBUTE = 'data-link-at';

/** The value the attribute holds. */
const ODD = '1';

/** The block tokens whose `tokens` are inline text. */
const INLINE_ROOTS = new Set(['paragraph', 'heading', 'text']);

/** How deep the walks go, a bound on the recursion over a document tree. */
const MAX_DEPTH = 200;

type Placed = Token & { place?: number; tokens?: Token[] };

function placeInline(tokens: readonly Token[], counter: { n: number }, depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const token of tokens as Placed[]) {
    if (token.type === 'link') {
      token.place = counter.n % 2;
      counter.n += 1;
    }
    if (Array.isArray(token.tokens)) placeInline(token.tokens, counter, depth + 1);
  }
}

/** Number the links of every block of inline text in `tokens`; returns `tokens`. */
export function placeLinks(tokens: Token[], depth = 0): Token[] {
  if (depth > MAX_DEPTH) return tokens;
  for (const token of tokens as Placed[]) {
    const node = token as unknown as Record<string, unknown>;
    if (INLINE_ROOTS.has(token.type) && Array.isArray(token.tokens)) {
      placeInline(token.tokens, { n: 0 }, depth + 1);
      continue;
    }
    if (token.type === 'table') {
      const header = node.header as Array<{ tokens: Token[] }>;
      const rows = node.rows as Array<Array<{ tokens: Token[] }>>;
      for (const cell of [...header, ...rows.flat()]) placeInline(cell.tokens, { n: 0 }, depth + 1);
      continue;
    }
    for (const key of ['tokens', 'items', 'inner']) {
      const child = node[key];
      if (Array.isArray(child)) placeLinks(child as Token[], depth + 1);
    }
  }
  return tokens;
}

/** The link HTML of `marked` with the attribute, where the link is an odd one. */
export function withLinkPlace(html: string, token: Token): string {
  return (token as Placed).place === 1 && html.startsWith('<a ')
    ? `<a ${LINK_PLACE_ATTRIBUTE}="${ODD}"${html.slice(2)}`
    : html;
}

/** The mark attribute, read from the element and rendered back onto it. */
export function linkPlaceMarkAttribute() {
  return {
    place: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(LINK_PLACE_ATTRIBUTE) === ODD ? ODD : null,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.place === ODD ? { [LINK_PLACE_ATTRIBUTE]: ODD } : {},
    },
  };
}
