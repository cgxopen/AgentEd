import { isAllowedUri } from '@tiptap/extension-link';
import { marked, type Tokens } from 'marked';
import type TurndownService from 'turndown';
import { isRelativeLinkAddress } from '../link-url';
import { angleDestination, inlineDestination } from './destination';
import { linkStart } from './link-start';
import {
  referenceAttribute,
  referenceMarkAttribute,
  referenceOf,
  referenceSpelling,
} from './reference';
import { softBreaksAsVoid } from './soft-break';

/**
 * A link the editor does not make live, kept as the file wrote it (#564,
 * owner decisions D1 and D2 on #564, comment 6119034528).
 *
 * Measured on the step zero of #564: three kinds of link left an unedited
 * save. **A link with no text**, `[](./target.md)`, is a mark with nothing to
 * mark, so the editor dropped it whole. **A link with no destination**,
 * `[link]()` or `[link](<>)`, is refused by the link mark at parse, so it came
 * back as its text. **A link whose scheme is on no list**, `<irc://foo.bar>` or
 * `[chat](irc://foo.bar)`, lost its href at DOMPurify, or at the link mark for
 * a scheme DOMPurify lets through, and came back as its text too.
 *
 * ── Kept as data, never as an href ──
 *
 * None of them is made live: widening an allow-list would put any registered
 * protocol handler into an href of the page, and an address of nothing is not
 * an address. So the `link` renderer of `parse.ts` asks `keptLink` first, with
 * the token, before DOMPurify sees any href:
 *
 * - **No text**: the bytes ride on the inert atom #563 made for raw HTML, not
 *   drawn, written back unchanged. It drew nothing before either.
 * - **Text, and a destination the editor would not make live**: the text is
 *   drawn plain inside a `span` that carries the bytes, and the serializer
 *   writes the bytes back while the text is as the file wrote it. An edit of
 *   the text lets the destination go and the text is written, as it was before
 *   #564: the shape #468 gave a wrapper (option i).
 *
 * **What is never kept**: an address of the five schemes R-C2 names unsafe,
 * `javascript:`, `vbscript:`, `file:`, `data:` and `blob:`, which loses its
 * destination on open as that exception records; and a reference link, whose
 * definition the serializer does not write (#570), so its bytes alone would
 * read back as text. Both are written as before. A paste keeps none of this,
 * as no paste keeps raw HTML as bytes (R-C13).
 */

/** Set on the `span` around the text of a kept link, holding its bytes. Stamped (#447). */
export const KEPT_LINK_ATTRIBUTE = 'data-kept-link';

/** Set beside it, holding the HTML its text was drawn from, to tell an edit. Stamped (#447). */
export const KEPT_LINK_TEXT_ATTRIBUTE = 'data-kept-link-text';

/**
 * Set beside them, the place of the link among those of its document, so two
 * kept links side by side with the same bytes stay two marks: the editor
 * joins neighbouring marks whose attributes are equal, and `[a](irc://x)`
 * twice came back as `aa` (review of #587). Stamped (#447).
 */
export const KEPT_LINK_PLACE_ATTRIBUTE = 'data-kept-link-at';

/** The place the next kept link takes; only told apart from its neighbours. */
let nextPlace = 0;

/** The schemes R-C2 records as never carried, read as a URL parser reads them. */
const UNSAFE_SCHEME = /^(?:javascript|vbscript|file|data|blob):/i;

/**
 * The address without a space, a C0 control character or DEL, which a URL
 * parser drops or ignores before it reads the scheme (#447), so `java`, a tab,
 * `script:` is still read as unsafe.
 */
function withoutIgnored(href: string): string {
  let kept = '';
  for (const character of href) {
    const code = character.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) kept += character;
  }
  return kept;
}

function isUnsafe(href: string): boolean {
  return UNSAFE_SCHEME.test(withoutIgnored(href));
}

/** Whether the bytes are an inline link or an autolink, which end with `)` or open with `<`. */
function isInlineSpelling(raw: string): boolean {
  return raw.startsWith('<') || raw.endsWith(')');
}

/**
 * A reference link of a destination the editor does not make live is kept
 * too since its definition is written (#570, R3): its spelling rides on the
 * span as a live reference carries it, and the bytes kept are the inline link
 * it reads as, written where its label no longer resolves (R2).
 */
function inlineBytes(token: Tokens.Link): string {
  const href = /[\s<>]/.test(token.href)
    ? angleDestination(token.href)
    : inlineDestination(token.href);
  const title = token.title ? ` "${token.title.replace(/["\\]/g, '\\$&')}"` : '';
  return `[${token.text}](${href}${title})`;
}

/** Whether the editor makes `href` a live link: the sanitizer keeps it and the link mark does. */
function isLive(href: string, sanitizerAllows: RegExp): boolean {
  if (href === '' || !sanitizerAllows.test(href)) return false;
  return isRelativeLinkAddress(href) || Boolean(isAllowedUri(href));
}

const encode = (text: string): string => encodeURIComponent(text);

/**
 * The HTML for a link token the editor does not make live, or `null` where the
 * link is rendered as before. `inner` is its text rendered, and `carrier` the
 * inert atom of #563 for bytes that draw nothing.
 */
export function keptLink(
  token: Tokens.Link,
  inner: string,
  sanitizerAllows: RegExp,
  carrier: (bytes: string) => string,
): string | null {
  const reference = referenceOf(token.raw);
  if ((!isInlineSpelling(token.raw) && reference === null) || isUnsafe(token.href)) return null;
  if (token.text === '' && reference === null) return carrier(token.raw);
  if (isLive(token.href, sanitizerAllows)) return null;
  nextPlace = (nextPlace + 1) % Number.MAX_SAFE_INTEGER;
  const place = `${KEPT_LINK_PLACE_ATTRIBUTE}="${nextPlace}"`;
  const raw = reference === null ? token.raw : inlineBytes(token);
  return `<span ${KEPT_LINK_ATTRIBUTE}="${encode(raw)}" ${KEPT_LINK_TEXT_ATTRIBUTE}="${encode(inner)}" ${place}${referenceAttribute(token.raw)}>${inner}</span>`;
}

/**
 * Whether `bytes` are a whole link with no text, as `keptLink` hands to the
 * carrier: the check the carrier makes before it believes a value (#447).
 */
export function isEmptyLinkBytes(bytes: string): boolean {
  if (!bytes.startsWith('[](') || isUnsafe(bytes.slice(3))) return false;
  const tokens = marked.Lexer.lexInline(bytes);
  const link = tokens[0] as Tokens.Link | undefined;
  return tokens.length === 1 && link?.type === 'link' && link.text === '' && link.raw === bytes;
}

/** The bytes and the drawn HTML of a kept link, or `null` where they are not believed. */
function keptBytes(span: HTMLElement): { raw: string; inner: string } | null {
  try {
    const raw = decodeURIComponent(span.getAttribute(KEPT_LINK_ATTRIBUTE) ?? '');
    const inner = decodeURIComponent(span.getAttribute(KEPT_LINK_TEXT_ATTRIBUTE) ?? '');
    const tokens = marked.Lexer.lexInline(raw);
    const link = tokens[0] as Tokens.Link | undefined;
    const whole = tokens.length === 1 && link?.type === 'link' && link.raw === raw;
    return whole && isInlineSpelling(raw) && !isUnsafe(link.href) ? { raw, inner } : null;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * The mark attributes, read from the element and rendered back onto it. The
 * editor holds both values as they are encoded.
 */
export function keptLinkMarkAttributes() {
  const attribute = (key: string, name: string) => ({
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute(name),
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[key];
      return typeof value === 'string' ? { [name]: value } : {};
    },
  });
  return {
    raw: attribute('raw', KEPT_LINK_ATTRIBUTE),
    inner: attribute('inner', KEPT_LINK_TEXT_ATTRIBUTE),
    at: attribute('at', KEPT_LINK_PLACE_ATTRIBUTE),
    ...referenceMarkAttribute(),
  };
}

/** A character that ends a delimiter run where it stands beside one: a space or a punctuation mark. */
const APART = /[\s\p{P}\p{S}]/u;

/**
 * Whether the marks around a kept link can be written around its bytes: what
 * stands on each side of it is nothing, a soft break, or text that opens or
 * ends with a space or a punctuation mark. Anything else, a letter or another
 * element, the same emphasis going on past the link above all, would meet
 * the delimiters written there, `*[a](irc://x)**b*` (review of #587).
 */
function standsApart(span: HTMLElement): boolean {
  const apart = (node: ChildNode | null, edge: 'first' | 'last'): boolean => {
    if (node === null || node.nodeName === 'BR') return true;
    if (node.nodeType !== 3) return false;
    const text = node.textContent ?? '';
    const character = edge === 'first' ? text.slice(0, 1) : text.slice(-1);
    return character === '' || APART.test(character);
  };
  return apart(span.previousSibling, 'last') && apart(span.nextSibling, 'first');
}

/**
 * The link written with its marks inside the brackets, as a live link in the
 * same place is written, under the exception of R-C2 for two overlapping
 * marks: the file text replaced by `content`, the rest of the bytes kept. An
 * autolink cannot hold a mark, so it is written as an inline link, as #567
 * writes one inside a mark. `null` where the bytes do not split as read.
 */
function insideBrackets(raw: string, content: string): string | null {
  const link = marked.Lexer.lexInline(raw)[0] as Tokens.Link | undefined;
  if (link?.type !== 'link') return null;
  if (raw.startsWith('<')) {
    return `[${content}](${inlineDestination(link.href)})`;
  }
  const close = 1 + link.text.length;
  return raw[close] === ']' ? `[${content}]${raw.slice(close + 1)}` : null;
}

/** Bytes that open with a bracket, marked as a link start, so a `!` before them is escaped (#565). */
function startingALink(written: string): string {
  return written.startsWith('[') ? `${linkStart()}${written}` : written;
}

/** Letters alone, which no escape of turndown touches, standing for the bytes. */
const SENTINEL = 'KeptLinkBytesGoHere';

/** How many marks around the text are looked through; a bound on the walk. */
const MAX_MARKS_AROUND = 16;

/**
 * Registered by `serialize.ts`: the text of a kept link is written as the
 * bytes while it writes what the text the file drew writes, so whatever the
 * serializer respells, it respells both alike; otherwise the text alone.
 *
 * Both are written through the soft break pass the save makes, or a text that
 * wraps a line never matched (review of #587). And the mark has the rank of a
 * link, so an emphasis the file put around the link is drawn inside it: where
 * the text is wrapped whole by such marks, the marks are written around the
 * bytes, `**[a](irc://x)**` as it was. An emphasis that covers the link and
 * more is split at its edge, as for a live link: the exception of R-C2 for
 * two overlapping marks.
 */
export function addKeptLinkRules(
  turndown: TurndownService,
  writesAsLabel: (content: string) => (label: string) => boolean,
): void {
  const write = (html: string): string => turndown.turndown(softBreaksAsVoid(`<p>${html}</p>`));

  /**
   * The marks around the whole text written around the bytes, or `null` where
   * the text is not wrapped whole by marks around what the file drew. The bytes
   * are put in by a split, never by a replacement, which would read `$&` and
   * the other dollar patterns in them (review of #587).
   */
  const inMarks = (span: HTMLElement, drawn: string, raw: string): string | null => {
    let element: Element = span;
    for (let depth = 0; depth < MAX_MARKS_AROUND; depth++) {
      const only = element.firstChild;
      if (element.childNodes.length !== 1 || only?.nodeType !== 1) return null;
      element = only as Element;
      if (write(element.innerHTML) !== drawn) continue;
      element.replaceChildren(SENTINEL);
      const parts = write(span.innerHTML).split(SENTINEL);
      return parts.length === 2 ? parts[0] + raw + parts[1] : null;
    }
    return null;
  };

  turndown.addRule('keptLink', {
    filter: (node) =>
      node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute(KEPT_LINK_ATTRIBUTE),
    replacement: (content, node) => {
      const span = node as HTMLElement;
      const kept = keptBytes(span);
      if (kept === null) return content;
      const drawn = write(kept.inner);
      // A reference whose label resolves is written as its reference (#570).
      const reference =
        content === drawn ? referenceSpelling(span, content, writesAsLabel(content), false) : null;
      if (reference !== null) return startingALink(reference);
      if (content === drawn) return startingALink(kept.raw);
      const around = inMarks(span.cloneNode(true) as HTMLElement, drawn, kept.raw);
      if (around === null) return content;
      return startingALink(
        standsApart(span) ? around : (insideBrackets(kept.raw, content) ?? content),
      );
    },
  });
}
