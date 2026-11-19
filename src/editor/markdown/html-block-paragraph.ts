import type TurndownService from 'turndown';
import { decodeKeptRawHtml, KEPT_RAW_HTML_ATTRIBUTE, KEPT_RAW_HTML_TAG } from './kept-raw-html';

/**
 * A paragraph that opens with a kept tag of an HTML block is written with its
 * text unescaped (#756).
 *
 * A raw block of an element the schema has no node for, an `aside` or a
 * `section`, is drawn as a paragraph whose start and end tags are inline
 * carriers (#563, `keepInsideBlock` in `kept-raw-html.ts`). Written back, the
 * start tag opens the line, and CommonMark reads a line that opens with a
 * start or end tag of a block name of its HTML block condition 6 as raw HTML,
 * whatever follows the tag on that line, at the top level, in a quote and in
 * a list item alike. Every character of the paragraph is then text, a
 * backslash included, so an escape written before a bracket was read back as
 * a backslash of the text, and the next save escaped it again: the
 * backslashes before a bracket went 0, 1, 3, 7, 15 over four saves.
 *
 * So the text of such a paragraph is written as the editor holds it, with no
 * escape, and the next read gives back the same text. The tags themselves are
 * written by their carriers as the bytes the file wrote, untouched here.
 *
 * **How the escape is skipped.** Turndown chooses the rule of an element
 * before it converts the children of that element, and calls the replacement
 * after. The filter of a paragraph rule calls `beginHtmlBlockText`, which
 * switches the escape off when the paragraph opens with such a tag, and its
 * replacement calls `endHtmlBlockText`. Two rules do: the one below, and the
 * rule of list item paragraphs in `serialize.ts`, which keeps the spacing of
 * a list. `htmlToMarkdown` switches the escape on again in its `finally`, so
 * an exception thrown between the two leaves no paragraph of the next
 * document unescaped. Paragraphs do not nest, so one switch is enough.
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

let escapingText = true;

/** Whether `bytes` begin with a start or an end tag of a condition 6 block name. */
function opensHtmlBlock(bytes: string): boolean {
  const name = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/.exec(bytes)?.[1];
  return name !== undefined && CONDITION_6.has(name.toLowerCase());
}

/** Whether the paragraph `node` opens with a kept tag of a condition 6 block name. */
function opensWithHtmlBlockTag(node: HTMLElement): boolean {
  if (node.nodeName !== 'P') return false;
  let first: Node | null = node.firstChild;
  while (first && first.nodeType === Node.TEXT_NODE && (first.textContent ?? '').trim() === '') {
    first = first.nextSibling;
  }
  if (!first || first.nodeName !== KEPT_RAW_HTML_TAG.toUpperCase()) return false;
  const bytes = decodeKeptRawHtml((first as HTMLElement).getAttribute(KEPT_RAW_HTML_ATTRIBUTE));
  return bytes !== null && opensHtmlBlock(bytes.trimStart());
}

/** Switch the escape off for the text of `node` when it opens with such a tag; answers whether it did. */
export function beginHtmlBlockText(node: HTMLElement): boolean {
  const opens = opensWithHtmlBlockTag(node);
  if (opens) escapingText = false;
  return opens;
}

/** Switch the escape on again, at the end of a paragraph and when `htmlToMarkdown` ends. */
export function endHtmlBlockText(): void {
  escapingText = true;
}

/** `escapeText`, answering text unchanged while a paragraph read as raw HTML is written. */
export function unlessHtmlBlockText(
  escapeText: (text: string) => string,
): (text: string) => string {
  return (text) => (escapingText ? escapeText(text) : text);
}

/** The rule for such a paragraph outside a list item, written as any paragraph is. */
export function addHtmlBlockParagraphRule(turndown: TurndownService): void {
  turndown.addRule('paragraphReadAsHtml', {
    filter: (node) => node.parentElement?.nodeName !== 'LI' && beginHtmlBlockText(node),
    replacement: (content) => {
      endHtmlBlockText();
      return `\n\n${content}\n\n`;
    },
  });
}
