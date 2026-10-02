/**
 * The GFM tag filter, as GitHub applies it (#461).
 *
 * GFM writes the opening `<` of the start and end tags of nine names as text,
 * in raw HTML blocks and inline alike, in any case: `title`, `textarea`,
 * `style`, `xmp`, `iframe`, `noembed`, `noframes`, `script` and `plaintext`
 * (the Disallowed Raw HTML extension, measured with `gh api markdown` on the
 * #461 step zero). `marked` does not, so until #461 AgentEd read them as tags,
 * and the text of each is not markup until its end tag: one left open inside a
 * paragraph cut everything after it, and the one real file the corpus held in
 * that shape, a placeholder written as `<title>` in prose, was written back as
 * 3873 bytes of 8772. GitHub shows it whole, and so does AgentEd now.
 *
 * A name that only begins like one of the nine, `<titlex>`, is not touched,
 * and neither is `noscript`, which GFM leaves alone.
 *
 * **A block holding one is written back as its own bytes while untouched**
 * (owner decision of 2026-10-02 on #461), the shape #283 gives a raw HTML
 * table: the block is shown as a paragraph of its text, and the paragraph
 * carries the bytes in `data-html-block-source`, which `kept-html-table.ts`
 * reads at save. An edit folds the block into a paragraph of that text.
 */

const NAMES = 'title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext';

/** The `<` of a start or end tag of one of the nine names. */
const FILTERED_TAG = new RegExp(`<(?=/?(?:${NAMES})(?=[\\s/>]|$))`, 'i');
const EVERY_FILTERED_TAG = new RegExp(FILTERED_TAG.source, 'gi');
const FILTERED_TAG_HERE = new RegExp(FILTERED_TAG.source, 'iy');

/** Where a block's own bytes ride between the parser and the paragraph. */
export const HTML_BLOCK_SOURCE_ATTRIBUTE = 'data-html-block-source';

export function holdsFilteredTag(html: string): boolean {
  return FILTERED_TAG.test(html);
}

/** `html` with the `<` of every start and end tag of the nine written as text. */
export function filterTags(html: string): string {
  return html.replace(EVERY_FILTERED_TAG, '&lt;');
}

/** Whether the `<` at `i` opens a tag of one of the nine, which GFM writes as text. */
export function filteredTagAt(raw: string, i: number): boolean {
  FILTERED_TAG_HERE.lastIndex = i;
  return FILTERED_TAG_HERE.test(raw);
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A raw HTML block holding one of the nine, as the paragraph the editor shows:
 * the text of the filtered block, and the bytes the file wrote. The text is
 * read through a `template`, whose content runs nothing and loads nothing; its
 * line breaks become spaces in the paragraph, as they do when GitHub draws the
 * block. Not through `DOMParser`, which in the test harness left the second of
 * two `&lt;` in a block undecoded, measured on #461.
 */
export function keptBlock(filtered: string, raw: string): string {
  const template = document.createElement('template');
  template.innerHTML = filtered;
  const text = template.content.textContent ?? '';
  const source = encodeURIComponent(raw.replace(/\n+$/, ''));
  return `<p ${HTML_BLOCK_SOURCE_ATTRIBUTE}="${source}">${escapeText(text.trim())}</p>\n`;
}

/**
 * The bytes carried on a paragraph, or `null` where there are none or they do
 * not hold one of the nine: a value the pipeline did not write is not
 * believed, the line #447 drew for every stamped attribute.
 */
export function decodeBlockSource(value: string | null): string | null {
  if (value === null || value === '') return null;
  try {
    const decoded = decodeURIComponent(value);
    return holdsFilteredTag(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
