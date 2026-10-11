import type { Token } from 'marked';
import type TurndownService from 'turndown';
import { holdsFilteredTag } from './tag-filter';

/**
 * Raw HTML the editor cannot hold, kept as the bytes the file wrote (#563).
 *
 * An unedited save dropped every piece of raw HTML that neither the schema nor
 * an earlier route holds: measured on the step zero of #563 (comment
 * 6106764512), 24 of the 40 spec examples of the cause went at DOMPurify
 * (`parse.ts`, the `sanitize` call) and 16 at the schema, and on 8706 files of
 * this machine an anchor with a `name` or an `id` was removed in 178 of 180
 * files holding one. The owner decided on that report (comment 6106861190).
 *
 * **The route is the one comments take (#245).** `marked` hands every such
 * piece to the `html` renderer with its bytes in `raw`. Where the piece holds
 * no text and only what the schema drops, it becomes an inert carrier, a `wbr`
 * whose attribute holds the bytes encoded as #245 encodes a comment, so the
 * bytes never reach the live document; the editor holds it as an atom that is
 * not drawn, and the serializer writes the bytes back.
 *
 * **What it takes, positively:** comments, processing instructions,
 * declarations and CDATA; an `a` with no `href`, and the `</a>` that closes it;
 * and any element not in `HELD` below, a `span` or an unknown one. What it never
 * takes: an `a` with an `href`, which is a link, nor anything the schema or
 * another route draws or keeps, listed in `HELD`. A piece that holds text is
 * not taken whole; the text is the document.
 *
 * It runs after the routes of #283, #300, #461 and #468 have had the piece:
 * `parse.ts` asks it only for a token none of them took.
 */

/** Set on the carrier, holding the bytes. Stripped from what a file spells (#447). */
export const KEPT_RAW_HTML_ATTRIBUTE = 'data-raw-html';

/** The carrier element: void, so turndown neither collapses it nor descends into it (#245). */
export const KEPT_RAW_HTML_TAG = 'wbr';

/**
 * Elements the schema draws, or another route keeps or deliberately drops, so
 * never taken here. `div` holding text and `noscript` are recorded R-C2
 * exceptions; `details`, `summary`, `p`, `center` and the headings are wrappers
 * of #468 and #470; the cell markup is #300; a table is #283.
 */
const HELD = new Set([
  'a',
  'img',
  'br',
  'hr',
  'em',
  'i',
  'strong',
  'b',
  's',
  'del',
  'strike',
  'code',
  'u',
  'sup',
  'sub',
  'kbd',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'input',
  'div',
  'center',
  'picture',
  'source',
  'details',
  'summary',
  'noscript',
  'wbr',
]);

/**
 * What a whole block holding no text may still not be taken for: elements that
 * draw something, which the schema holds or a recorded exception removes. A
 * block of nothing else holds nothing the reader sees, so keeping its bytes
 * loses nothing even where its tags are `div` or `p`: an empty `div` with
 * attributes, examples 153 and 154 (#563).
 */
const DRAWS = new Set([
  'img',
  'br',
  'hr',
  'input',
  'picture',
  'source',
  'video',
  'audio',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'noscript',
]);

/** One piece of markup: a construct, or a start or end tag. */
const PIECE =
  /<!--(?:-?>|[\s\S]*?-->)|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![A-Za-z][^>]*>|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?)\/?>/g;

/** Whether a start tag carries an `href`, which makes an `a` a link. */
function hasHref(attributes: string): boolean {
  return /(?:^|\s)href\s*=/i.test(attributes);
}

/**
 * The `a` elements open before a piece: those this route took, which carry no
 * `href`, and links. A `</a>` closes the latest; one closing nothing is stray.
 */
export interface AnchorsOpen {
  readonly kept: number;
  readonly links: number;
}

const NONE_OPEN: AnchorsOpen = { kept: 0, links: 0 };

/**
 * Whether `text` holds no text and only what this route takes, given the
 * anchors open before it; the anchors open after it come back with the answer.
 * A `</a>` is taken when it closes an anchor this route took, or nothing at
 * all, and never when it closes a link.
 */
export function keptPiece(
  text: string,
  before: AnchorsOpen = NONE_OPEN,
  wholeBlock = false,
): { kept: boolean; after: AnchorsOpen } {
  const refusedTags = wholeBlock ? DRAWS : HELD;
  let { kept, links } = before;
  const refused = { kept: false, after: before };
  if (holdsFilteredTag(text)) return refused;
  let rest = text;
  let pieces = 0;
  for (const match of text.matchAll(PIECE)) {
    pieces++;
    rest = rest.replace(match[0], '');
    const name = match[2]?.toLowerCase();
    if (name === undefined) continue; // a comment, an instruction, a declaration, CDATA
    if (name === 'a') {
      if (match[1] === '') {
        if (hasHref(match[3] ?? '')) return refused;
        kept++;
      } else if (kept > 0) {
        kept--;
      } else if (links > 0) {
        return refused;
      }
      continue;
    }
    if (refusedTags.has(name)) return refused;
  }
  if (pieces === 0 || rest.trim() !== '') return refused;
  return { kept: true, after: { kept, links } };
}

/** The anchors open after a piece this route does not take: links open and close. */
function followLinks(text: string, before: AnchorsOpen): AnchorsOpen {
  let { kept, links } = before;
  for (const match of text.matchAll(PIECE)) {
    if (match[2]?.toLowerCase() !== 'a') continue;
    if (match[1] === '') links++;
    else if (links > 0) links--;
    else if (kept > 0) kept--;
  }
  return { kept, links };
}

/**
 * Mark the `html` tokens this route takes, before anything is rendered. A walk
 * over the whole token list because an `a` without an `href` and its `</a>`
 * are two inline tokens with text between them, and only the pair decides.
 */
export function markKeptRawHtml(tokens: Token[]): Token[] {
  const walk = (list: Token[]): void => {
    let open = NONE_OPEN;
    for (const token of list) {
      if (token.type === 'html') {
        const raw = (token as { raw: string }).raw;
        const verdict = keptPiece(raw, open, (token as { block?: boolean }).block === true);
        if (verdict.kept) (token as { keptRawHtml?: boolean }).keptRawHtml = true;
        open = verdict.kept ? verdict.after : followLinks(raw, open);
      }
      const node = token as unknown as Record<string, unknown>;
      // `inner` holds the blocks of a `details` region (#563).
      for (const key of ['tokens', 'items', 'header', 'inner']) {
        const child = node[key];
        if (Array.isArray(child)) walk(child as Token[]);
      }
      if (Array.isArray(node.rows)) for (const row of node.rows as Token[][]) walk(row);
    }
  };
  walk(tokens);
  return tokens;
}

/** The carrier for a taken token: inline, or a paragraph holding it for a block. */
export function keptRawHtmlCarrier(raw: string, block: boolean): string {
  // A block keeps the line the file gave it; the blank lines after it are the
  // paragraph's, written by the serializer as for any paragraph.
  const bytes = block ? raw.replace(/\s+$/, '') : raw;
  const carrier = `<${KEPT_RAW_HTML_TAG} ${KEPT_RAW_HTML_ATTRIBUTE}="${encodeURIComponent(bytes)}">`;
  return block ? `<p>${carrier}</p>\n` : carrier;
}

/**
 * The bytes back, or `null` where the value is not what this route keeps: a
 * value the pipeline did not write is not believed (#447), and a malformed
 * escape answers `null` rather than throwing on open.
 */
export function decodeKeptRawHtml(value: string | null): string | null {
  if (value === null || value === '') return null;
  try {
    const decoded = decodeURIComponent(value);
    // A lone `</a>` was taken because it closed an anchor this route took.
    return keptPiece(decoded.trim(), { kept: 1, links: 0 }, true).kept ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Inside an HTML block the editor draws, each piece this route would take on
 * its own replaced by its inline carrier: a comment, an instruction, a
 * declaration or CDATA sharing a block with other markup, and the tags of an
 * element the schema drops, such as an unknown one around text (#563). An `a`
 * is left as it was, since only its pair decides; so is every element in
 * `HELD`, and the block is drawn as before.
 *
 * **A construct with no text before it and text after it is left as it was.**
 * Written back, it would open the paragraph the text becomes, and a line that
 * opens with a comment, an instruction, a declaration or CDATA is read as raw
 * HTML, its text no longer markdown, so the file would move on every save:
 * example 177, measured. A tag does not open a block that way when text
 * follows it on its line, so it needs no such guard.
 */
export function keepInsideBlock(html: string): string {
  const visible = (part: string) => part.replace(PIECE, '').trim() !== '';
  return html.replace(
    PIECE,
    (piece, close: string | undefined, name: string | undefined, _a, at: number) => {
      if (name !== undefined) {
        const tag = name.toLowerCase();
        return tag === 'a' || HELD.has(tag) || holdsFilteredTag(piece)
          ? piece
          : keptRawHtmlCarrier(piece, false);
      }
      void close;
      const before = visible(html.slice(0, at));
      const after = visible(html.slice(at + piece.length));
      return !before && after ? piece : keptRawHtmlCarrier(piece, false);
    },
  );
}

/** The marks for `sup`, `sub` and `kbd`, written back as the tag, plain (#563). */
const INLINE_ELEMENTS = ['sup', 'sub', 'kbd'] as const;

/**
 * The serializer rules of this module, registered by `serialize.ts` so that
 * file does not grow: the carrier writes its bytes, and the three marks write
 * their tag. Every `sup`, `sub` and `kbd` of the 8706 files measured on the
 * step zero is spelled plain, with no attribute, so plain is what is written.
 */
export function addKeptRawHtmlRules(turndown: TurndownService): void {
  turndown.addRule('keptRawHtml', {
    filter: (node) =>
      node.nodeName === KEPT_RAW_HTML_TAG.toUpperCase() &&
      (node as HTMLElement).hasAttribute(KEPT_RAW_HTML_ATTRIBUTE),
    replacement: (_content, node) =>
      decodeKeptRawHtml((node as HTMLElement).getAttribute(KEPT_RAW_HTML_ATTRIBUTE)) ?? '',
  });
  turndown.addRule('inlineElements', {
    filter: [...INLINE_ELEMENTS],
    replacement: (content, node) => {
      const tag = node.nodeName.toLowerCase();
      return content === '' ? '' : `<${tag}>${content}</${tag}>`;
    },
  });
}
