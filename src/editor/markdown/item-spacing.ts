/**
 * The blank line between two blocks of a list item (#601).
 *
 * ── What was lost ──
 *
 * A list item writes some of its blocks one newline apart: the paragraph of
 * a bullet or ordered item over its nested list, so that a list made with Tab
 * stays tight (`listItemParagraph` in `serialize.ts`), and every block of a
 * task item (`taskListItemReplacement`). A file that wrote a blank line there
 * lost it on an unedited save: `- a`, a blank line, `- b` indented by two came
 * back with `- b` directly under `a`, and GitHub, which read the outer list
 * loose, then read it tight, so `a` lost its paragraph. Measured on the step
 * zero of #573 (item 4d): 108 files of the corpus snapshot held the shape and
 * 92 lost it.
 *
 * ── Why the adjacency carrier holds it ──
 *
 * The carrier of #568 and #590 already reads the gap above every block of an
 * item, at the token, and writes it on the block below: empty for no blank
 * line, a count from 2 up for a run. One blank line was the one gap it left
 * unwritten, since everywhere else it is what a block is written with anyway.
 * In an item it is not, so there `adjacency.ts` writes it as 1, and this
 * module is where the writers of an item ask for it. A second attribute on
 * the nested list, as prototype P6 of that step zero held it, would have read
 * the same gap from the same tokens, and reached a nested list alone: the
 * paragraphs and the heading of a task item a blank line apart would still
 * have lost theirs.
 *
 * ── Only a file ──
 *
 * The count is read only where the parse keeps raw HTML, which is a file and
 * never a paste, as every value of the attribute is. A nested list made with
 * Tab, a block pasted into an item and the second half of a block split by
 * Enter carry nothing, so they are written as before: tight under the
 * paragraph of a bullet item, one newline apart in a task item.
 */
import { ADJACENT_ATTRIBUTE } from './adjacency';

/**
 * Whether the file wrote this block of a list item one blank line or more
 * under the one above: the count, 1 for one blank line and from 2 up for a
 * run, whose further lines the run writer of `adjacency-save.ts` adds.
 */
export function blankLineAbove(block: Element | null): boolean {
  return /^\d+$/.test(block?.getAttribute(ADJACENT_ATTRIBUTE) ?? '');
}
