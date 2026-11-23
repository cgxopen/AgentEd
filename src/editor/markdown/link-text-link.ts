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
 * ── A reference, which has no parenthesis ──
 *
 * The text `[b][l]`, `[b][]` or `[b]`, where the document defines the label,
 * is read by `marked` inside the link as a reference once the backslashes are
 * gone, and no backslash `marked` keeps can be put in it. So where the reader
 * still finds a link inside, the bracket that closes each link it finds is
 * written as the character reference `&#93;`: `[a \[b&#93;](u)`. A reference
 * is text to `marked`, so it reads no bracket there, and every reader shows
 * the character. One round at a time, since closing one link can leave
 * another for the reader to find: `[b&#93;[&#93;` for `[b][]`. Measured on the
 * sweep of #762 beside the opening bracket and beside every escaped opening
 * bracket: all three held every reference shape, and this one wrote the
 * fewest bytes. The reference is written after the escape, so the ampersand
 * gains no backslash (#565).
 *
 * A stand-in of #605 before a bracket of a text this rule rewrites is written
 * as the backslash: #605 weighs it by `marked` alone, which reads the text the
 * same either way, and a bare bracket there splits the link for CommonMark.
 * GitHub links no URL inside the text of a link.
 *
 * ── What it does not reach ──
 *
 * Where neither step leaves the reader finding what the text holds, within
 * the bound on rounds, the link is written as before. No shape of the sweep of
 * #762 is left so. The plain text of a copy (#697) is written with no
 * definition beside it, so its references are bare escapes there; pasted into
 * a document, it is read as one link and written by this rule.
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

/** A stand-in of #605 before a bracket. */
const HELD_BEFORE_A_BRACKET = new RegExp(`${AUTOLINK_LITERAL_MARK}([[\\]])`, 'g');

/** The most rounds of character references for one link; past it the link is written as it was. */
const MAX_ROUNDS = 8;

/** What `marked` does to the text of a link before it reads it (`outputLinkReplace` of 15.0.12). */
const UNESCAPED_BRACKET = /\\([[\]])/g;

/**
 * `text` as the reader reads it inside a link, its escaped brackets bare,
 * with the offset in `text` of each character it keeps.
 */
function unescapedInside(text: string): { read: string; from: number[] } {
  let read = '';
  const from: number[] = [];
  let cursor = 0;
  for (const match of text.matchAll(UNESCAPED_BRACKET)) {
    for (let i = cursor; i < match.index; i += 1) from.push(i);
    read += text.slice(cursor, match.index);
    from.push(match.index + 1);
    read += match[1];
    cursor = match.index + 2;
  }
  for (let i = cursor; i < text.length; i += 1) from.push(i);
  return { read: read + text.slice(cursor), from };
}

/** The offset in `raw`, a link token, of the bracket that closes it: its text, or its label. */
function closingBracket(raw: string): number {
  return raw.endsWith(')') ? raw.lastIndexOf('](') : raw.lastIndexOf(']');
}

/**
 * The offsets in `text` of the escaped brackets to write as character
 * references: the bracket that closes each link the reader finds inside the
 * text once the backslashes are gone, where the text escaped it.
 */
function bracketsToSpell(text: string): number[] {
  const escaped = new Set([...text.matchAll(UNESCAPED_BRACKET)].map((match) => match.index + 1));
  const { read, from } = unescapedInside(text);
  const found: Array<[Token, number]> = [];
  walk(readInline(read), read, 0, found);
  const brackets = new Set<number>();
  for (const [token, at] of found) {
    if (!isLink([token, at]) || at < 0) continue;
    const inText = from[at + closingBracket(token.raw)];
    if (inText !== undefined && escaped.has(inText) && text[inText] === ']') brackets.add(inText);
  }
  return [...brackets];
}

/** `text` with the escaped closing bracket at each offset written as `&#93;`. */
function withCharacterReferences(text: string, at: readonly number[]): string {
  let out = text;
  for (const offset of [...at].sort((a, b) => b - a)) {
    out = `${out.slice(0, offset - 1)}&#93;${out.slice(offset + 1)}`;
  }
  return out;
}

/**
 * `written`, the bytes a link rule wrote for a link whose text turndown wrote
 * as `content`, with each parenthesis that would open a destination inside
 * the text escaped, where the reader reads more inside the link than in its
 * text. Anything else is returned as it was.
 */
export function heldApartFromItsText(written: string, content: string): string {
  // A backslash #605 holds as a stand-in is read as the backslash it may stay.
  const reading = (bytes: string) => bytes.replaceAll(AUTOLINK_LITERAL_MARK, '\\');
  if (!reading(content).includes('\\]')) return written;
  const start = written.startsWith(LINK_START) ? LINK_START.length : 0;
  if (written.slice(start, start + content.length + 2) !== `[${content}]`) return written;
  const after = written.slice(start + content.length + 2);
  const inText = tokensOf(reading(content)).filter(isLink).length;
  const insideOf = (text: string) => readInside(reading(`[${text}]${after}`));
  const asWritten = insideOf(content);
  if (asWritten === -1 || asWritten <= inText) return written;
  // A bracket of the text rewritten keeps its backslash beside a URL too, where
  // #605 would weigh it by `marked` alone; GitHub links no URL inside a link.
  const finished = (text: string) =>
    `${written.slice(0, start)}[${text.replace(HELD_BEFORE_A_BRACKET, '\\$1')}]${after}`;
  let text = content;
  const openings = openingsAfterEscapedBrackets(reading(text));
  if (openings.length > 0) {
    text = withBackslashes(text, openings);
    if (insideOf(text) === inText) return finished(text);
  }
  // The links the reader still finds inside, a reference among them, lose a
  // bracket to a character reference, one round at a time, while some are found.
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const brackets = bracketsToSpell(reading(text));
    if (brackets.length === 0) return written;
    text = withCharacterReferences(text, brackets);
    if (insideOf(text) === inText) return finished(text);
  }
  return written;
}

/** A link replacement of turndown, wrapped so its bytes pass through the rule above. */
export function holdingLinkTextApart(
  replacement: (content: string, node: Node, options: Options) => string,
): (content: string, node: Node, options: Options) => string {
  return (content, node, options) =>
    heldApartFromItsText(replacement(content, node, options), content);
}
