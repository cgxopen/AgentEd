import type TurndownService from 'turndown';
import { decodeKeptRawHtml, KEPT_RAW_HTML_ATTRIBUTE, KEPT_RAW_HTML_TAG } from './kept-raw-html';

/**
 * A paragraph whose first piece is a kept tag that opens an HTML block,
 * written with its text unescaped (#756, route E of the step zero).
 *
 * A raw block of an element the schema has no node for, an `aside` or a
 * `section`, is drawn as a paragraph whose start and end tags are kept as
 * inline carriers (#563, `keepInsideBlock`). Written back, the start tag opens
 * the line, and CommonMark reads a line that opens with one of the block names
 * of its HTML block condition 6 as raw HTML whatever follows it on the line:
 * every character of the paragraph is then text, a backslash included. So the
 * escapes the serializer puts before a bracket became text at the next read,
 * and the next save escaped them again, without end.
 *
 * Such a paragraph is written with the escapes taken off its text again, so
 * what the next read takes as text is the text the editor holds.
 */

/** The block names of CommonMark HTML block condition 6. */
const CONDITION_6 = new Set(
  (
    'address article aside base basefont blockquote body caption center col colgroup dd ' +
    'details dialog dir div dl dt fieldset figcaption figure footer form frame frameset ' +
    'h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav ' +
    'noframes ol optgroup option p param search section summary table tbody td tfoot th ' +
    'thead title tr track ul'
  ).split(' '),
);

/** Whether `bytes` is a start or end tag of a condition 6 block name. */
function opensHtmlBlock(bytes: string): boolean {
  const name = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/.exec(bytes)?.[1];
  return name !== undefined && CONDITION_6.has(name.toLowerCase());
}

/** Whether the paragraph `node` opens with a kept tag that opens an HTML block. */
function opensWithHtmlBlockTag(node: HTMLElement): boolean {
  if (node.nodeName !== 'P' || node.parentElement?.nodeName === 'LI') return false;
  let first: Node | null = node.firstChild;
  while (first && first.nodeType === Node.TEXT_NODE && (first.textContent ?? '').trim() === '') {
    first = first.nextSibling;
  }
  if (!first || first.nodeName !== KEPT_RAW_HTML_TAG.toUpperCase()) return false;
  const bytes = decodeKeptRawHtml((first as HTMLElement).getAttribute(KEPT_RAW_HTML_ATTRIBUTE));
  return bytes !== null && opensHtmlBlock(bytes.trimStart());
}

/** The escapes of the serializer taken off: a backslash before ASCII punctuation. */
function unescaped(markdown: string): string {
  return markdown.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

export function addHtmlBlockParagraphRule(turndown: TurndownService): void {
  turndown.addRule('paragraphReadAsHtml', {
    filter: (node) => opensWithHtmlBlockTag(node as HTMLElement),
    replacement: (content) => `\n\n${unescaped(content)}\n\n`,
  });
}
