import type { BlankReplacement, Options } from 'turndown';

/**
 * Keeping a heading, a quote and a list item that hold nothing (#564).
 *
 * `## `, `>` and `-` alone on their lines are each a construct CommonMark
 * reads, `marked` and DOMPurify keep, and the editor holds: a heading with no
 * text, a quote holding an empty paragraph, an item holding an empty
 * paragraph. An unedited save dropped all three, because a node with no text
 * is **blank** to turndown, and a blank node is replaced by the blank rule
 * before any rule for its tag is consulted - the mechanism `empty-fence.ts`
 * describes for a fence (#94). The default blank rule writes a blank block as
 * a blank line, so the construct left the file, and in a tight list the blank
 * line it left behind made the list loose: `- foo`, `-`, `- bar` came back as
 * two items a blank line apart.
 *
 * So the blank rule asks this module first, for a blank node whose content
 * wrote nothing, and each answer is the construct's own marker with nothing
 * after it:
 *
 * - **A heading** is its hashes, as many as its level: `##`. No closing hashes
 *   and no space, so no trailing whitespace reaches the file.
 * - **A quote** is its marker, written by the rule that writes a quote holding
 *   text, so it is `>` where the file spelled its blank quote lines bare and
 *   `> ` where it did not, the answer `blockquote-spacing.ts` carries (#199).
 * - **A list item** is its marker, written by the rule that writes an item
 *   holding text, so it takes the marker its list carries (#431) and the
 *   number its place gives it, or the one number its list repeats (#569), and
 *   the line after it is the one its list's spacing writes (#28). The space
 *   that rule puts after the marker is taken back off, since nothing follows
 *   it.
 *
 * Every other blank node is left to the default, an empty paragraph above
 * all: markdown has no spelling for one. So is an empty checklist item, which
 * a loose checklist can hand over since #160: a checkbox with nothing after it
 * is a question of its own, and #564 does not take it.
 *
 * ── An empty first item under a paragraph (#564, owner decision D3) ──
 *
 * A nested list is written on the line under the paragraph of its item, and
 * there an empty first item is not an item: a lone `-` is a setext underline,
 * so `- foo` over `  -` reads back as a heading, and GitHub reads a lone `*`,
 * `+` or `1.` as text continuing the paragraph, since an empty item cannot
 * interrupt one. So the `listItemParagraph` rule writes such a list a blank
 * line under the paragraph, asking `opensWithAnEmptyItem`, the one spelling
 * `marked` and GitHub both read as the item. A checklist item writes its
 * blocks one at a time, where a blank line would cost the checkbox on GitHub,
 * so there the empty first item of a `-` list is left out as before #564, the
 * exception R-C2 records, and `withoutAnUnderline` does that.
 */

/** The rules that write a quote and a list item holding text, from `serialize.ts`. */
export interface EmptyBlockWriters {
  readonly blockquote: BlankReplacement;
  readonly listItem: BlankReplacement;
}

const HEADING = /^H([1-6])$/;

/** The space after a marker, where the marker is the whole of the line. */
const SPACE_AFTER_THE_MARKER = / (\n*)$/;

/** Whether `li` holds nothing but empty paragraphs, so it is written as its marker alone. */
function isEmptyItem(li: Element): boolean {
  return (
    li.textContent === '' &&
    Array.from(li.children).every((child) => child.nodeName === 'P' && child.children.length === 0)
  );
}

/** Whether `list` is a list whose first item is written as its marker alone. */
export function opensWithAnEmptyItem(list: Element | null): boolean {
  const first = list?.firstElementChild;
  return (
    (list?.nodeName === 'UL' || list?.nodeName === 'OL') && first != null && isEmptyItem(first)
  );
}

/** A lone `-` opening a block, which is what an empty first item writes. */
const LEADING_UNDERLINE = /^-(?:\n|$)/;

/**
 * A block a checklist item is about to write on the line under its paragraph,
 * with the empty first item of a `-` list left out, as the default leaves it
 * out elsewhere: written alone, the list cannot ask what is above it. Only an
 * empty item writes a lone `-`, so nothing else is taken.
 */
export function withoutAnUnderline(written: string): string {
  return written.replace(LEADING_UNDERLINE, '');
}

function emptyListItem(node: Node, options: Options, writers: EmptyBlockWriters): string | null {
  if ((node as Element).parentElement?.getAttribute('data-type') === 'taskList') return null;
  return writers.listItem('', node, options).replace(SPACE_AFTER_THE_MARKER, '$1');
}

/**
 * The markdown for a blank `node` whose content wrote nothing, or `null` where
 * it is not one of the three constructs and the default blank rule decides.
 */
export function emptyBlock(
  node: Node,
  options: Options,
  writers: EmptyBlockWriters,
): string | null {
  const heading = HEADING.exec(node.nodeName);
  if (heading) return `\n\n${'#'.repeat(Number(heading[1]))}\n\n`;
  if (node.nodeName === 'BLOCKQUOTE') return writers.blockquote('', node, options);
  if (node.nodeName === 'LI') return emptyListItem(node, options, writers);
  return null;
}
