import { marked, type Token } from 'marked';
import type { Options } from 'turndown';
import { AUTOLINK_LITERAL_MARK } from './autolink-literal-escape';
import { LINK_START } from './link-start';
import { resolves } from './reference';

/**
 * A link whose text shows a link of its own, written so no reader finds a
 * destination inside it (#762).
 *
 * The text of a link may show a link as text: `a [b](c)` selected and made a
 * link in the editor, or the credit of a pull quote, a raw `a` holding a
 * markdown link. Turndown escapes the brackets and leaves the parenthesis, so
 * the save wrote `[a \[b\](c)](u)`. CommonMark reads one link whose text
 * shows `[b](c)`. `marked` 15.0.12 does not: before it reads the text of a
 * link it takes the backslash off every bracket in it (`outputLink`, the
 * `outputLinkReplace` of its rules), so it reads `[b](c)` there as a link of
 * its own, and the editor held two links, which the second save wrote.
 *
 * ── Asked of the reader ──
 *
 * The rule does not restate that behaviour. It asks the `marked` of
 * `parse.ts` twice: how many links and images it reads inside the link as
 * written, and how many it reads in the text alone, where every escape
 * stands. Where the first is the larger, the link would be read with more
 * inside it than the editor holds, and the parenthesis right after each
 * escaped closing bracket in the text gets a backslash. `marked` takes no
 * backslash off a parenthesis, and every reader reads `\(` as the character,
 * so the text shows the same and no destination stands in it. The two counts
 * are asked again of the result; where they still differ, the link is
 * written as before.
 *
 * Only the opening parenthesis is escaped: the closing one needs no backslash
 * once nothing opens a destination, and a backslash right after a URL is one
 * GitHub can take into an address (#605). The parentheses found are the ones
 * `marked` reads as text after an escape token, so a code span in the text,
 * whose bytes are its own, is never touched.
 *
 * ── What it does not reach ──
 *
 * A reference has no parenthesis: the text `[b][l]`, `[b][]` or `[b]`, where
 * the document defines the label, is read by `marked` inside the link as a
 * reference once the backslashes are gone. The rule finds it and writes it as
 * before, since no backslash `marked` keeps can be put in it. R-C2 records it.
 */

/** The links of the document being written, as `marked` looks a label up: any label that resolves. */
const DEFINED_LINKS = new Proxy({} as Record<string, { href: string; title: string }>, {
  get: (_target, label) =>
    typeof label === 'string' && resolves(label) ? { href: '#', title: '' } : undefined,
});

/** The most tokens walked for one link; past it the link is written as it was. */
const MAX_TOKENS = 10000;

/** The inline tokens of `source`, read with the labels the document defines. */
function readInline(source: string): Token[] {
  const lexer = new marked.Lexer(marked.defaults);
  Object.assign(lexer.tokens, { links: DEFINED_LINKS });
  return lexer.inlineTokens(source);
}

/** Every token of `tokens` and of the tokens inside them, in reading order, with its offset in `base`. */
function walk(tokens: readonly Token[], base: string, offset: number, out: Array<[Token, number]>) {
  let cursor = 0;
  for (const token of tokens) {
    if (out.length > MAX_TOKENS) return;
    const at = base.indexOf(token.raw, cursor);
    const start = at < 0 ? -1 : offset + at;
    if (at >= 0) cursor = at + token.raw.length;
    out.push([token, start]);
    if ('tokens' in token && Array.isArray(token.tokens)) {
      walk(token.tokens as Token[], at < 0 ? '' : token.raw, start, out);
    }
  }
}

function tokensOf(source: string): Array<[Token, number]> {
  const out: Array<[Token, number]> = [];
  walk(readInline(source), source, 0, out);
  return out;
}

const isLink = ([token]: [Token, number]) => token.type === 'link' || token.type === 'image';

/** Links and images `marked` reads inside the one link `written` makes, or -1 where it makes none. */
function readInside(written: string): number {
  const tokens = readInline(written);
  const link = tokens[0];
  if (tokens.length !== 1 || link?.type !== 'link' || link.raw !== written) return -1;
  const inside: Array<[Token, number]> = [];
  walk((link as { tokens?: Token[] }).tokens ?? [], '', 0, inside);
  return inside.filter(isLink).length;
}

/** The offsets of `text` holding a parenthesis right after a bracket `marked` reads as escaped. */
function openingsAfterEscapedBrackets(text: string): number[] {
  const openings: number[] = [];
  for (const [token, start] of tokensOf(text)) {
    if (token.type !== 'escape' || token.raw !== '\\]' || start < 0) continue;
    if (text[start + 2] === '(') openings.push(start + 2);
  }
  return openings;
}

function withBackslashes(text: string, at: readonly number[]): string {
  let out = '';
  let from = 0;
  for (const offset of at) {
    out += `${text.slice(from, offset)}\\`;
    from = offset;
  }
  return out + text.slice(from);
}

/**
 * `written`, the bytes a link rule wrote for a link whose text turndown wrote
 * as `content`, with each parenthesis that would open a destination inside
 * the text escaped, where the reader reads more inside the link than in its
 * text. Anything else is returned as it was.
 */
export function heldApartFromItsText(written: string, content: string): string {
  if (!content.includes('\\]')) return written;
  const start = written.startsWith(LINK_START) ? LINK_START.length : 0;
  if (written.slice(start, start + content.length + 2) !== `[${content}]`) return written;
  // A backslash #605 holds as a stand-in is read as the backslash it may stay.
  const reading = (bytes: string) => bytes.replaceAll(AUTOLINK_LITERAL_MARK, '\\');
  const inText = tokensOf(reading(content)).filter(isLink).length;
  const asWritten = readInside(reading(written.slice(start)));
  if (asWritten === -1 || asWritten <= inText) return written;
  const openings = openingsAfterEscapedBrackets(reading(content));
  if (openings.length === 0) return written;
  const held = withBackslashes(content, openings);
  const rewritten = `[${held}]${written.slice(start + content.length + 2)}`;
  if (readInside(reading(rewritten)) !== inText) return written;
  return `${written.slice(0, start)}${rewritten}`;
}

/** A link replacement of turndown, wrapped so its bytes pass through the rule above. */
export function holdingLinkTextApart(
  replacement: (content: string, node: Node, options: Options) => string,
): (content: string, node: Node, options: Options) => string {
  return (content, node, options) =>
    heldApartFromItsText(replacement(content, node, options), content);
}
