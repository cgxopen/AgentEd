import { marked } from 'marked';
import type { Options } from 'turndown';
import { angleDestination, inlineDestination, literalAmpersands } from './destination';
import { LINK_START } from './link-start';
import { linkTitle } from './link-title';

/**
 * A destination that does not read back between parentheses is written
 * between angle brackets (#761).
 *
 * The inline link rule writes the href the editor holds between parentheses,
 * escaping the backslash and the parentheses (#664). A destination there
 * holds no unescaped white space, so a raw `a` whose href holds a space,
 * `https://example.com/a b`, was written `[text](https://example.com/a b)`,
 * which no reader takes for a link: the second save wrote it as text with its
 * brackets escaped, and the link was gone from the file. The same for a tab,
 * a relative path such as `my notes.md`, and an angle bracket in the address,
 * where the rest of the line could turn bold.
 *
 * ── Asked of the reader ──
 *
 * The link as written is put to the `marked` of `parse.ts`: it must read as
 * one link over the whole of it, whose destination is the one written, the
 * href with its ampersands as `literalAmpersands` writes them. Where it does
 * not, the destination is written between angle brackets, the form
 * `angleDestination` gives and the carrier of #573 already keeps, and asked
 * again; where that fails too, as for a line break, which no destination
 * holds, the link is written as before.
 *
 * **The ampersands are written as in the inline form** (#447): an ampersand
 * that would begin a character reference is written `&amp;` inside the angle
 * brackets too, by `angleDestination` since #761, so an href holding
 * `javascript&colon;alert(1)` and a space stays the inert text it is.
 *
 * An href of ASCII letters, digits and the punctuation a plain destination
 * holds reads back between parentheses by construction, and is not asked:
 * most links are of that kind, and each question is one lex.
 */

/** The characters of a destination written bare between parentheses, unasked. */
const PLAIN_DESTINATION = /^[A-Za-z0-9\-._~:/?#@!$+,;=%*'&]*$/;

/** Whether `markdown` reads as one link over all of it, with `destination` as its destination. */
function readsAsOneLink(markdown: string, destination: string): boolean {
  const tokens = marked.Lexer.lexInline(markdown, marked.defaults);
  const link = tokens[0] as { type?: string; raw?: string; href?: string } | undefined;
  return (
    tokens.length === 1 &&
    link?.type === 'link' &&
    link.raw === markdown &&
    link.href === destination
  );
}

/**
 * `written`, the bytes the inline link rule wrote for `element`, with its
 * destination between angle brackets where it does not read back between
 * parentheses and does between the brackets. Anything else as it was.
 */
export function readingBackItsDestination(written: string, element: HTMLElement): string {
  const href = element.getAttribute('href') ?? '';
  if (PLAIN_DESTINATION.test(href)) return written;
  const title = linkTitle(element);
  const inline = `(${inlineDestination(href)}${title})`;
  if (!written.endsWith(inline)) return written;
  const start = written.startsWith(LINK_START) ? LINK_START.length : 0;
  const destination = literalAmpersands(href);
  if (readsAsOneLink(written.slice(start), destination)) return written;
  const angled = `${written.slice(0, -inline.length)}(${angleDestination(href)}${title})`;
  return readsAsOneLink(angled.slice(start), destination) ? angled : written;
}

/** A link replacement of turndown, wrapped so its destination passes through the rule above. */
export function readingDestinationsBack(
  replacement: (content: string, node: Node, options: Options) => string,
): (content: string, node: Node, options: Options) => string {
  return (content, node, options) =>
    readingBackItsDestination(replacement(content, node, options), node as HTMLElement);
}
