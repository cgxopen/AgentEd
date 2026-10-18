import { HTML_BLOCK_SOURCE_ATTRIBUTE } from './tag-filter';

/**
 * A raw HTML block the editor draws as a paragraph or a heading, kept as its
 * bytes while it is unedited (#572, owner decision 1 of 2026-10-18, route
 * k3w of the step zero).
 *
 * A centred block of images, `sup` and `br`, the shape of sponsor and logo
 * blocks, is drawn as a paragraph holding hard breaks. The first save wrote
 * those breaks as two spaces and a newline, which made lines of spaces and
 * spaces at the end of the block, and the next read folded them: the file
 * moved again on the second save, 28 corpus files (13 distinct) with the
 * region check beside it in `kept-html-table.ts`.
 *
 * So the block the editor draws is stamped with the bytes the file wrote,
 * the carrier #468 gives a wrapper, and written back as them while it reads
 * back as the same block. Only where the drawing is unchanged by the stamp:
 * a `p`, a heading, or a `div` or `center` holding inline content alone, as
 * the first element of the block. A block whose inline content comes before
 * any element is drawn as it was and carries nothing: stamping it drew 47
 * corpus files (40 distinct) otherwise than before, a space lost at the edge
 * of a paragraph or blocks split apart (K3 of the step zero, not taken).
 */

/** The elements a block of the editor can be drawn from. */
const BLOCKS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'div',
  'center',
  'details',
  'summary',
  'hr',
  'picture',
  'img',
]);

/** The elements stamped themselves: their drawing is the block the editor holds. */
const STAMPED = /^(?:p|h[1-6])$/;

function encode(raw: string): string {
  return encodeURIComponent(raw.replace(/\n+$/, ''));
}

function isBlock(node: Node): boolean {
  return node.nodeType === 1 && BLOCKS.has((node as Element).nodeName.toLowerCase());
}

/** `drawn`, the HTML of the raw block `raw`, with the bytes stamped on the block it becomes, or as it was. */
export function stampRawBlock(drawn: string, raw: string): string {
  const template = document.createElement('template');
  template.innerHTML = drawn;
  const nodes = Array.from(template.content.childNodes);
  const first = nodes.findIndex(isBlock);
  if (first < 0) return drawn;
  const leading = nodes.slice(0, first);
  if (leading.some((node) => node.nodeType !== 3 || (node.textContent ?? '').trim() !== '')) {
    return drawn;
  }
  const element = nodes[first] as Element;
  const name = element.nodeName.toLowerCase();
  const inlineBox =
    (name === 'div' || name === 'center') && !Array.from(element.childNodes).some(isBlock);
  if (!STAMPED.test(name) && !inlineBox) return drawn;
  element.setAttribute(HTML_BLOCK_SOURCE_ATTRIBUTE, encode(raw));
  return `${template.innerHTML}\n`;
}

/** Whether `decoded` is bytes this route stamps: a raw block opening with a tag. */
export function isRawBlockBytes(decoded: string): boolean {
  return /^ {0,3}<[A-Za-z!?/]/.test(decoded);
}
