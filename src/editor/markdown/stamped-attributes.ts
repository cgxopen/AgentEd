/**
 * The attributes this pipeline stamps for itself, and the one guard that keeps
 * a document from supplying them (#447).
 *
 * ── Why a guard ──
 *
 * The parser carries what a file spelled on attributes of the elements it
 * builds: the bytes of an HTML image or table, how a list was spaced and
 * marked, the blank lines of a quote, a comment, the lines of a footnote. The
 * serializer then trusts those attributes, which is right for every one the
 * parser wrote. But DOMPurify keeps every `data-*` attribute, so raw HTML in a
 * file could spell the same names, and pasted HTML could too, and both were
 * read as if the pipeline had written them. Measured on #20 and #447: an image
 * tag carried encoded inside a hand-written `data-html-source`, inert in every
 * renderer, was written back by an untouched save as a live tag with an event
 * handler; the entries of a hand-written `data-footnote-indents` were written
 * as a heading or a raw tag; a hand-written comment carrier became a comment.
 *
 * So HTML that comes from outside has these attributes taken out before the
 * pipeline stamps its own, at the two places it enters: the raw HTML tokens of
 * a file, in the `html` renderer of `parse.ts`, and pasted HTML, in
 * `cleanPastedHtml`. What a document wrote stays in its bytes where the
 * pipeline keeps bytes - a kept table, an HTML image - as the inert text it
 * was; it is only no longer believed.
 *
 * ── What is not on the list ──
 *
 * `data-type` and `data-checked` (owner decision of 2026-10-01 on #447). The
 * task list pass stamps them, but they are also what TipTap writes, so a
 * checklist copied out of another TipTap page arrives through them, and what a
 * document can say with them is a checkbox, which #20 measured as bounded.
 *
 * ── Comments are left alone ──
 *
 * The scan skips an HTML comment whole, so a tag spelled inside one is the
 * comment text it is and is never rewritten.
 */

import { BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE } from './blockquote-spacing';
import { MARKDOWN_COMMENT_ATTRIBUTE } from './comment-spelling';
import {
  FOOTNOTE_BLANK_LINE_ATTRIBUTE,
  FOOTNOTE_DEFINITION_ATTRIBUTE,
  FOOTNOTE_INDENTS_ATTRIBUTE,
} from './footnote';
import {
  IMAGE_HTML_SOURCE_ATTRIBUTE,
  stampImageSources,
  tagEnd,
  withoutTagAttribute,
} from './image-spelling';
import { KEPT_RAW_HTML_ATTRIBUTE } from './kept-raw-html';
import { LIST_MARKER_ATTRIBUTE } from './list-marker';
import { LIST_SPACING_ATTRIBUTE } from './list-spacing';
import {
  SOFT_BREAK_ATTRIBUTE,
  SOFT_BREAK_INDENT_ATTRIBUTE,
  SOFT_BREAK_SPACE_ATTRIBUTE,
} from './soft-break';
import { TABLE_HTML_SOURCE_ATTRIBUTE } from './table-html-source';
import { TABLE_STYLE_ATTRIBUTE } from './table-style';
import { HTML_BLOCK_SOURCE_ATTRIBUTE } from './tag-filter';

/** Every attribute the pipeline stamps for itself and the serializer trusts. */
export const STAMPED_ATTRIBUTES: readonly string[] = [
  IMAGE_HTML_SOURCE_ATTRIBUTE,
  TABLE_HTML_SOURCE_ATTRIBUTE,
  HTML_BLOCK_SOURCE_ATTRIBUTE,
  TABLE_STYLE_ATTRIBUTE,
  LIST_SPACING_ATTRIBUTE,
  LIST_MARKER_ATTRIBUTE,
  BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE,
  MARKDOWN_COMMENT_ATTRIBUTE,
  KEPT_RAW_HTML_ATTRIBUTE,
  FOOTNOTE_DEFINITION_ATTRIBUTE,
  FOOTNOTE_INDENTS_ATTRIBUTE,
  FOOTNOTE_BLANK_LINE_ATTRIBUTE,
  SOFT_BREAK_ATTRIBUTE,
  SOFT_BREAK_SPACE_ATTRIBUTE,
  SOFT_BREAK_INDENT_ATTRIBUTE,
];

/** One tag with every stamped attribute taken out, each however often it appears. */
function withoutStamped(tag: string): string {
  return STAMPED_ATTRIBUTES.reduce(withoutTagAttribute, tag);
}

/**
 * `html` with `rewrite` applied to every opening tag and nothing else.
 *
 * One left-to-right pass: text, closing tags and the inside of a comment are
 * copied as they are, and an unterminated tag or comment ends the scan with
 * the rest copied unchanged. Every branch moves `i` forward, so the pass is
 * bounded by the length of `html`.
 */
function eachOpeningTag(html: string, rewrite: (tag: string) => string): string {
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) break;
    out.push(html.slice(i, open));
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      const end = close === -1 ? html.length : close + 3;
      out.push(html.slice(open, end));
      i = end;
      continue;
    }
    const end = /[A-Za-z]/.test(html[open + 1] ?? '') ? tagEnd(html, open) : -1;
    if (end === -1) {
      out.push('<');
      i = open + 1;
      continue;
    }
    out.push(rewrite(html.slice(open, end)));
    i = end;
  }
  out.push(html.slice(i));
  return out.join('');
}

/** Whether an opening tag is an `img`. */
function isImageTag(tag: string): boolean {
  return /^<img[\s/>]/i.test(tag) || tag.toLowerCase() === '<img';
}

/**
 * HTML from outside - pasted, or a raw HTML token of a file - with no
 * attribute this pipeline stamps for itself.
 */
export function withoutStampedAttributes(html: string): string {
  return eachOpeningTag(html, withoutStamped);
}

/**
 * A raw HTML token of a file, ready for the stamps that follow it: every
 * stamped attribute the file spelled is taken out, and each image is stamped
 * with its own bytes as the file wrote them, the hand-written attributes
 * included as the inert text they are.
 */
export function stampedFromTheFile(html: string): string {
  const others = eachOpeningTag(html, (tag) => (isImageTag(tag) ? tag : withoutStamped(tag)));
  return stampImageSources(others, withoutStamped);
}
