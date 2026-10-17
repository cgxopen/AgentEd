import { HTML_BLOCK_SOURCE_ATTRIBUTE } from './tag-filter';

/**
 * The bytes of raw HTML put on the first block it is drawn as (#604), for the
 * routes of a `dl` and of a media block. The HTML is drawn as it was drawn
 * before; only the attribute of #461 is added, which is never rendered, so
 * what the editor shows does not change.
 *
 * Where the HTML begins with inline content, text or carriers, that content
 * is put into a paragraph of its own, which is the paragraph the editor draws
 * for it already, and the paragraph carries the bytes. Where it begins with a
 * paragraph or a heading, that block carries them. Anything else carries
 * nothing, and the HTML keeps the loss it had.
 */

/** Elements that start a block of the editor; anything else at the start is inline content. */
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

/** An image read as inline content where `imagesInline` is set: the poster of a media element. */
const IMAGES = new Set(['picture', 'img']);

/** `html` with the bytes `raw` on its first block, or unchanged where no block can carry them. */
export function withBytesOnFirstBlock(html: string, raw: string, imagesInline: boolean): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const box = template.content;
  const nodes = Array.from(box.childNodes);
  const starts = (n: Node) => {
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const name = (n as Element).nodeName.toLowerCase();
    return BLOCKS.has(name) && !(imagesInline && IMAGES.has(name));
  };
  const first = nodes.findIndex(starts);
  const leading = nodes.slice(0, first < 0 ? nodes.length : first);
  const bytes = encodeURIComponent(raw.replace(/\n+$/, ''));
  if (leading.some((n) => n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() !== '')) {
    const paragraph = document.createElement('p');
    paragraph.setAttribute(HTML_BLOCK_SOURCE_ATTRIBUTE, bytes);
    box.insertBefore(paragraph, leading[0]);
    for (const n of leading) paragraph.appendChild(n);
    return `${template.innerHTML}\n`;
  }
  const element = first < 0 ? null : (nodes[first] as Element);
  if (element && /^(?:p|h[1-6])$/i.test(element.nodeName)) {
    element.setAttribute(HTML_BLOCK_SOURCE_ATTRIBUTE, bytes);
    return `${template.innerHTML}\n`;
  }
  return html;
}
