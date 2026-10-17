import type { Token, Tokens } from 'marked';
import { isCodeElementBytes } from './code-element-bytes';
import { closingDetails, isOneRegion, withClosingRest } from './details-region-ends';
import { isDlRegion } from './dl-region';
import { HTML_BLOCK_SOURCE_ATTRIBUTE, holdsFilteredTag } from './tag-filter';

/**
 * An HTML block that wraps an image or text, kept as its own bytes while it is
 * untouched (#468, owner decision of 2026-10-02 on #468).
 *
 * A centred image is spelled on GitHub with a raw HTML block around it, a `p`
 * or a `div` with `align`. The schema has no node for the wrapper, so
 * ProseMirror lifted the content out of it and the serializer wrote the image
 * back alone: measured on the #468 step zero in Chromium through the editor,
 * the five shapes of the issue and 96 more, each losing its wrapper and
 * nothing else. Not `marked` and not DOMPurify: both keep the wrapper.
 *
 * The route is the one #283 gives a raw table. The wrapper is drawn as one
 * paragraph holding what it held, the image drawn as an image, and the
 * paragraph carries the bytes the file wrote in the attribute #461 gave every
 * paragraph; `kept-html-table.ts` writes them back while the paragraph is
 * unedited, decided at save by reading the bytes again. An edit lets the
 * wrapper go, as it went before (option i of the decision). A wrapper whose
 * content becomes more than one block reads back as more than one paragraph,
 * so it is never marked unedited and keeps the loss it had.
 */

/** Wrappers drawn as the paragraph their content becomes; the tag itself is not drawn. */
const BLOCK_WRAPPERS = new Set(['p', 'div', 'center', 'details']);

/** Wrappers that are content themselves, kept whole inside the paragraph: a link keeps its mark. */
const INLINE_WRAPPERS = new Set(['a', 'picture']);

/** One element, its start tag at the very start and its own end tag at the very end. */
const ONE_ELEMENT = /^<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])[^>]*>([\s\S]*)<\/\1\s*>$/;

/** A start tag alone, the opening of shape 5 of #468. */
const START_TAG_ALONE = /^<(p|div|center|details|a)(?=[\s>])[^>]*>$/i;

function encode(raw: string): string {
  return encodeURIComponent(raw.replace(/\n+$/, ''));
}

/** The wrapper `raw` is, by its element name, or `null` where it is not one of them. */
function wrapperName(raw: string): string | null {
  const match = ONE_ELEMENT.exec(raw.trim());
  // A wrapper of nothing wraps nothing: its bytes are kept whole by #563
  // instead, where this route drew an empty paragraph that was written as
  // nothing (examples 153 and 154).
  if (!match || match[2].trim() === '') return null;
  const name = match[1].toLowerCase();
  return BLOCK_WRAPPERS.has(name) || INLINE_WRAPPERS.has(name) ? name : null;
}

/** A heading spelled as HTML, `h1` to `h6`, one element alone (#470). */
const HEADING = /^h[1-6]$/;

function headingName(raw: string): string | null {
  const match = ONE_ELEMENT.exec(raw.trim());
  return match && HEADING.test(match[1].toLowerCase()) ? match[1].toLowerCase() : null;
}

/** Whether `raw` is a wrapper or a heading whose bytes this module keeps, by its spelling. */
export function isHtmlWrapper(raw: string): boolean {
  return wrapperName(raw) !== null || headingName(raw) !== null || joinedWrapperName(raw) !== null;
}

/**
 * A raw HTML heading, as the heading the editor draws, its bytes stamped on
 * its own start tag the way #283 stamps a `table` (#470). GitHub centres a
 * heading only this way or with a wrapper, and the heading node carries its
 * level and nothing else, so the alignment was lost on an untouched save.
 */
export function headingBlock(html: string, raw: string): string | null {
  const name = headingName(raw);
  if (name === null) return null;
  const tag = new RegExp(`^(\\s*<${name})(?=[\\s>])`, 'i');
  if (!tag.test(html)) return null;
  return html.replace(tag, `$1 ${HTML_BLOCK_SOURCE_ATTRIBUTE}="${encode(raw)}"`);
}

/**
 * A raw HTML block that is one wrapper, as the element the editor reads into a
 * paragraph carrying the block's bytes, or `null` where it is not one. `html`
 * is the block as the pipeline has already rendered it, its images stamped.
 */
export function wrapperBlock(html: string, raw: string): string | null {
  const name = wrapperName(raw);
  if (name === null) return null;
  const match = ONE_ELEMENT.exec(html.trim());
  if (!match || match[1].toLowerCase() !== name) return null;
  const inner = BLOCK_WRAPPERS.has(name) ? match[2] : html.trim();
  return `<div ${HTML_BLOCK_SOURCE_ATTRIBUTE}="${encode(raw)}">${inner}</div>\n`;
}

/** The token shape 5 of #468 is joined into: the bytes, and the paragraph between. */
export interface HtmlWrapperToken {
  readonly type: 'htmlWrapper';
  readonly raw: string;
  /** The one block between the tags: a paragraph, or a block of raw HTML such as an image. */
  readonly content: Tokens.Paragraph | Tokens.HTML | Tokens.Heading;
  /** The start tag, for a wrapper that is content itself: a link keeps its mark. */
  readonly inlineStartTag: string | null;
  readonly name: string;
}

/** The element name of a wrapper spelled as shape 5, a start tag, content, an end tag. */
function joinedWrapperName(raw: string): string | null {
  const lines = raw.trim().split('\n');
  const first = START_TAG_ALONE.exec(lines[0]?.trim() ?? '');
  if (!first) return null;
  const last = lines[lines.length - 1]?.trim().toLowerCase();
  return last === `</${first[1].toLowerCase()}>` ? first[1].toLowerCase() : null;
}

/** The next index after `i` that is not a blank-line token. */
function nextContent(tokens: Token[], i: number): number {
  let j = i + 1;
  while (j < tokens.length && tokens[j].type === 'space') j++;
  return j;
}

/**
 * Shape 5 of #468: a start tag alone, a blank line, a paragraph, a blank line,
 * the end tag alone. CommonMark ends an HTML block at a blank line, so `marked`
 * hands it over as three blocks, and the wrapper is joined here into one token
 * holding the bytes of all three and the block between, before anything is
 * rendered. Inside a quote and a list item too. One block between, a paragraph
 * or raw HTML such as an image: a wrapper around more than one block, or one
 * whose start tag shares its line with another, keeps the loss it had.
 */
export function joinWrappers(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'blockquote' && token.tokens) token.tokens = joinWrappers(token.tokens);
    if (token.type === 'list')
      for (const item of token.items) item.tokens = joinWrappers(item.tokens);
    const open = token.type === 'html' ? START_TAG_ALONE.exec(token.raw.trim()) : null;
    if (open) {
      const p = nextContent(tokens, i);
      const k = nextContent(tokens, p);
      const close = tokens[k];
      const content = tokens[p];
      if (
        (content?.type === 'paragraph' ||
          content?.type === 'html' ||
          content?.type === 'heading') &&
        close?.type === 'html' &&
        close.raw.trim().toLowerCase() === `</${open[1].toLowerCase()}>`
      ) {
        const raw = tokens
          .slice(i, k + 1)
          .map((t) => t.raw)
          .join('');
        const name = open[1].toLowerCase();
        const joined: HtmlWrapperToken = {
          type: 'htmlWrapper',
          raw,
          content: content as Tokens.Paragraph | Tokens.HTML | Tokens.Heading,
          inlineStartTag: INLINE_WRAPPERS.has(name) ? token.raw.trim() : null,
          name,
        };
        out.push(joined as unknown as Token);
        i = k;
        continue;
      }
    }
    out.push(token);
  }
  return out;
}

/**
 * The element the editor reads shape 5 into: what it holds, rendered, and for a
 * link its own start tag around it, `startTag` already cleaned of what the
 * pipeline stamps (#447).
 */
export function joinedWrapperBlock(
  token: HtmlWrapperToken,
  content: string,
  startTag: string | null,
): string {
  const inner = startTag === null ? content : `${startTag}${content}</${token.name}>`;
  // A markdown heading between the tags is drawn as that heading (#470).
  const element = token.content.type === 'heading' ? `h${token.content.depth}` : 'div';
  return `<${element} ${HTML_BLOCK_SOURCE_ATTRIBUTE}="${encode(token.raw)}">${inner}</${element}>\n`;
}

/**
 * The bytes carried on a paragraph, or `null` where there are none or they are
 * neither a block of the tag filter (#461) nor a wrapper this module keeps: a
 * value the pipeline did not write is not believed (#447).
 */
export function decodeKeptBlockSource(value: string | null): string | null {
  if (value === null || value === '') return null;
  try {
    const decoded = decodeURIComponent(value);
    return holdsFilteredTag(decoded) ||
      isHtmlWrapper(decoded) ||
      isDetailsRegion(decoded) ||
      isCodeElementBytes(decoded) ||
      isDlRegion(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

/**
 * A paragraph that is one `a` or one `picture` and nothing else, as the
 * element the editor reads into a paragraph carrying its bytes, or `null`.
 * CommonMark reads such a line as a paragraph holding inline HTML, not as an
 * HTML block, so it reaches the paragraph renderer rather than the `html` one;
 * measured on the #468 step zero, a link wrapping an image on one line and a
 * `picture` lost the wrapper the same way.
 */
export function inlineWrapperParagraph(raw: string, inline: string): string | null {
  const name = wrapperName(raw);
  if (name === null || !INLINE_WRAPPERS.has(name)) return null;
  return `<div ${HTML_BLOCK_SOURCE_ATTRIBUTE}="${encode(raw)}">${inline}</div>\n`;
}

/**
 * A `details` holding several blocks, kept as its bytes while it is untouched
 * (#563, owner decision on #563, candidate a of the step zero).
 *
 * The usual spelling is the start tag and its `summary` as one HTML block, the
 * body as markdown blocks after a blank line, and the end tag alone, so the
 * join of shape 5 above, which takes one block between the tags, does not
 * reach it: measured on the step zero of #563, 121 of 127 files holding a
 * `details` lost it on an unedited save, keeping the summary and the body as
 * paragraphs.
 *
 * The blocks are joined into one token holding all their bytes and drawn as
 * they were drawn before, the summary as a paragraph first; that paragraph
 * carries the bytes. At save `kept-html-table.ts` reads the bytes again, and
 * where they give the blocks the editor holds, writes the bytes in their place.
 * An edit to any of them lets the `details` go, as option i of #468 lets a
 * wrapper go, and an undo brings the bytes back.
 */
export interface HtmlRegionToken {
  readonly type: 'htmlRegion';
  readonly raw: string;
  /** The start tag and what shares its block, the summary as a rule. */
  readonly opening: string;
  /** The blocks between the opening and the end tag. */
  readonly inner: Token[];
}

const DETAILS_OPEN = /^<details(?=[\s>])[^>]*>/i;

/**
 * Whether `raw` is one `details` region: its start tag first, every `details`
 * it opens ended, what its last block holds after the end tag included (#604).
 */
export function isDetailsRegion(raw: string): boolean {
  return isOneRegion(raw.trim());
}

/** Join each `details` spread over several blocks into one region token. */
export function joinDetailsRegions(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'blockquote' && token.tokens)
      token.tokens = joinDetailsRegions(token.tokens);
    if (token.type === 'list')
      for (const item of token.items) item.tokens = joinDetailsRegions(item.tokens);
    const opens =
      token.type === 'html' &&
      DETAILS_OPEN.test(token.raw.trim()) &&
      !/<\/details\s*>/i.test(token.raw);
    const end = opens ? closingDetails(tokens, i) : -1;
    if (end > i + 1) {
      const raw = tokens
        .slice(i, end + 1)
        .map((t) => t.raw)
        .join('');
      // A summary written as a block of its own, after a blank line below the
      // start tag, is part of the opening: drawn as its text, it carries the
      // bytes as a summary on the start tag's line does.
      const s = nextContent(tokens, i);
      const summary =
        s < end && tokens[s].type === 'html' && /^<summary(?=[\s>])/i.test(tokens[s].raw.trim())
          ? s
          : i;
      const region: HtmlRegionToken = {
        type: 'htmlRegion',
        raw,
        opening: tokens
          .slice(i, summary + 1)
          .map((t) => t.raw)
          .join(''),
        // A `details` inside it is a region of its own, and what the last block
        // holds after the end tag is drawn after the blocks (#604).
        inner: withClosingRest(joinDetailsRegions(tokens.slice(summary + 1, end)), tokens[end]),
      };
      out.push(region as unknown as Token);
      i = end;
      continue;
    }
    out.push(token);
  }
  return out;
}

/**
 * The region as the editor reads it: the text of its opening as a paragraph
 * carrying the bytes, then its blocks as they render. An opening with no text
 * stamps the first block when that is a paragraph or a heading; otherwise the
 * blocks are drawn with nothing kept, the loss there was before.
 */
export function detailsRegionBlock(token: HtmlRegionToken, inner: string): string {
  const template = document.createElement('template');
  template.innerHTML = token.opening;
  const text = (template.content.textContent ?? '').trim();
  const stamp = `${HTML_BLOCK_SOURCE_ATTRIBUTE}="${encode(token.raw)}"`;
  if (text !== '') {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<p ${stamp}>${escaped}</p>\n${inner}`;
  }
  const first = /^(\s*<(?:p|h[1-6]))(?=[\s>])/i;
  return first.test(inner) ? inner.replace(first, `$1 ${stamp}`) : inner;
}
