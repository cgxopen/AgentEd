import { isAllowedUri } from '@tiptap/extension-link';
import { marked, type Tokens } from 'marked';
import type TurndownService from 'turndown';
import { isRelativeLinkAddress } from '../link-url';

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

/**
 * Whether the bytes are an inline link or an autolink: a reference link ends
 * with its label, and its definition is not written (#570).
 */
function isInlineSpelling(raw: string): boolean {
  return raw.startsWith('<') || raw.endsWith(')');
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
  if (!isInlineSpelling(token.raw) || isUnsafe(token.href)) return null;
  if (token.text === '') return carrier(token.raw);
  if (isLive(token.href, sanitizerAllows)) return null;
  return `<span ${KEPT_LINK_ATTRIBUTE}="${encode(token.raw)}" ${KEPT_LINK_TEXT_ATTRIBUTE}="${encode(inner)}">${inner}</span>`;
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
  const attribute = (name: string) => ({
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute(name),
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[name === KEPT_LINK_ATTRIBUTE ? 'raw' : 'inner'];
      return typeof value === 'string' ? { [name]: value } : {};
    },
  });
  return { raw: attribute(KEPT_LINK_ATTRIBUTE), inner: attribute(KEPT_LINK_TEXT_ATTRIBUTE) };
}

/**
 * Registered by `serialize.ts`: the text of a kept link is written as the
 * bytes while it writes what the text the file drew writes, so whatever the
 * serializer respells, it respells both alike; otherwise the text alone.
 */
export function addKeptLinkRules(turndown: TurndownService): void {
  turndown.addRule('keptLink', {
    filter: (node) =>
      node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute(KEPT_LINK_ATTRIBUTE),
    replacement: (content, node) => {
      const kept = keptBytes(node as HTMLElement);
      if (kept === null) return content;
      return content === turndown.turndown(`<p>${kept.inner}</p>`) ? kept.raw : content;
    },
  });
}
