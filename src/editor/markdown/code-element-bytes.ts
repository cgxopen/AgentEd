import type { Token, Tokens } from 'marked';
import { HTML_BLOCK_SOURCE_ATTRIBUTE } from './tag-filter';

/**
 * A raw `code` element with markup inside it, kept as the bytes of its block
 * (#604, K4 of the step zero, owner decision 1 of 2026-10-17).
 *
 * ── What was lost ──
 *
 * `<code><b>x</b> y</code>` in a line is read by GitHub as one code element
 * holding a bold `x`. The code mark of the editor holds text alone, so the
 * `b` became a mark beside it and the serializer wrote two spans,
 * `**`x`**` and `` ` y` ``, which GitHub reads as two code elements. The same
 * for a `code` holding a link, an `i`, or a markdown link GitHub reads inside
 * it. Measured on the step zero (comment 6236166181), 27 files (17 distinct)
 * of the corpus snapshot, the files #613 counted: 3 (3) in a paragraph, 21
 * (12) in a list item, and 3 (2) inside a raw `dl`, which this route does
 * not reach. Inside a raw `p` such a line was kept already, by the wrapper of
 * #468.
 *
 * ── The route ──
 *
 * A paragraph, or the text of a list item, whose inline tokens hold a raw
 * `code` start tag with anything but text before its end tag, carries its
 * bytes on the paragraph it is drawn as, in the attribute #461 gave every
 * paragraph. It is drawn as before. At save `kept-html-table.ts` reads the
 * bytes again and writes them while the paragraph is what they read as, so an
 * edit lets them go and the paragraph is written as before, option i of
 * #468, and an undo brings them back. The text of a list item is handed over
 * as the paragraph token `marked` would build, as #602 does for a loose item,
 * so it reaches the paragraph renderer; the editor holds a paragraph in an
 * item either way.
 */

const OPEN_CODE = /^<code(?:\s[^>]*)?>$/i;
const CLOSE_CODE = /^<\/code\s*>$/i;

/** How deep the walk below reads tokens held inside tokens. */
const MAX_DEPTH = 20;

/** Whether inline tokens hold a raw `code` element with anything but text inside it. */
export function holdsCodeWithMarkup(tokens: readonly Token[] | undefined, depth = 0): boolean {
  // Past this nesting nothing more is read, and the block is written as before.
  if (!tokens || depth > MAX_DEPTH) return false;
  let open = 0;
  for (const token of tokens) {
    const raw = token.type === 'html' ? token.raw.trim() : '';
    if (OPEN_CODE.test(raw)) {
      open++;
      continue;
    }
    if (CLOSE_CODE.test(raw)) {
      if (open > 0) open--;
      continue;
    }
    if (open > 0 && token.type !== 'text' && token.type !== 'escape') return true;
    if (holdsCodeWithMarkup((token as { tokens?: Token[] }).tokens, depth + 1)) return true;
  }
  return false;
}

/** The paragraph carrying its bytes, or `null` where it holds no such element. */
export function codeElementParagraph(token: Tokens.Paragraph, inline: string): string | null {
  if (!holdsCodeWithMarkup(token.tokens)) return null;
  const bytes = encodeURIComponent(token.raw.replace(/\n+$/, ''));
  return `<p ${HTML_BLOCK_SOURCE_ATTRIBUTE}="${bytes}">${inline}</p>\n`;
}

/** The text tokens of an item holding such an element, handed over as paragraph tokens. */
export function codeElementItemText(item: Tokens.ListItem): void {
  // `marked` writes the checkbox of a task item into the same text.
  if (item.task) return;
  item.tokens.forEach((token, i) => {
    if (token.type !== 'text') return;
    const inline = (token as Tokens.Text).tokens;
    if (!holdsCodeWithMarkup(inline)) return;
    const paragraph: Tokens.Paragraph = {
      type: 'paragraph',
      raw: token.raw,
      text: (token as Tokens.Text).text,
      tokens: inline ?? [],
    };
    item.tokens[i] = paragraph;
  });
}

/**
 * Whether bytes carried on a paragraph are what this route writes, so the
 * paragraph believes them: they hold a `code` start tag and its end tag. A
 * value the pipeline did not write is not believed (#447); what a file spells
 * in this attribute is taken out before any stamp is made.
 */
export function isCodeElementBytes(decoded: string): boolean {
  return /<code(?:\s[^>]*)?>[\s\S]*<\/code\s*>/i.test(decoded);
}
