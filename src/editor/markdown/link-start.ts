/**
 * A `!` written right before a link (#565, owner decision D3 on #565).
 *
 * `\![foo](/url)` is an exclamation mark and a link. `marked` reads the
 * escape as the character, the editor holds the `!` as text, and turndown
 * escapes no `!`, so the save wrote `![foo](/url)`, an image the file never
 * held: CommonMark example 593, R-C13.
 *
 * ── Why a mark, and where it is answered ──
 *
 * Whether the `!` opens an image depends on the node after it, and the escape
 * sees one text node: the vantage point the escape exception of R-C2 names.
 * So each rule that writes a link starting with `[` puts a private-use
 * character before it, and the assembled markdown answers it: a `!` right
 * before the mark gains a backslash, unless it is escaped already, and the
 * mark goes. This is the route #409 gave a footnote reference. A table cell
 * is answered on its own before its width is counted, or the mark would count
 * as a character of the column.
 *
 * **A document that already holds the mark character makes no mark** (the
 * step aside of #425): answering would delete the character the person typed.
 * In such a document the `!` keeps the loss it had before #565.
 */

/** Put before a link written with `[`. Private Use Area, so nothing else writes it. */
export const LINK_START = '';

/** Whether the conversion under way marks link starts; set by `htmlToMarkdown`. */
let marking = false;

/** Set the flag, and return the value it held, for the caller to restore. */
export function setMarkingLinkStarts(value: boolean): boolean {
  const previous = marking;
  marking = value;
  return previous;
}

/** The mark to put before a link, or nothing where no mark is made. */
export function linkStart(): string {
  return marking ? LINK_START : '';
}

/** A `!` before a mark, with the backslashes before it, in a bounded run. */
const BANG_BEFORE_A_LINK = /(\\{0,64})!/g;

/** Each mark answered: a `!` before it escaped where it is not already, and the mark removed. */
export function answerLinkStarts(markdown: string): string {
  if (!markdown.includes(LINK_START)) return markdown;
  return markdown
    .replace(BANG_BEFORE_A_LINK, (_whole: string, slashes: string) =>
      slashes.length % 2 === 0 ? `${slashes}\\!` : `${slashes}!`,
    )
    .replaceAll(LINK_START, '');
}
