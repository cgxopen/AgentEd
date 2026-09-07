/**
 * How a list was spaced in the file it came from (#28).
 *
 * A CommonMark list is **loose** when blank lines separate its items, and its
 * items then render wrapped in `<p>` with real vertical space between them.
 * AgentEd used to write every list back tight, so a document opened and saved
 * with no edits rendered differently afterwards — the first R-C2 exception
 * recorded, and the one this module removes.
 *
 * **The spelling is a property of the file**, the way a table's column widths
 * are (#93), and like those it has to be read from the raw markdown: by the
 * time the HTML exists the distinction is still visible, but by the time the
 * *document model* exists it is not. `listItem` takes `block+`, so both
 * spellings arrive as `listItem(paragraph)` and `editor.getHTML()` re-emits
 * the wrapper for a tight list too — measured, and it is why an attribute is
 * needed at all rather than a serializer repair.
 *
 * ── Why the `<p>` wrapper is not the thing to read ──
 *
 * `marked` wraps item bodies in `<p>` for **two** different reasons, because
 * CommonMark calls a list loose when its items are separated by blank lines
 * **or** when any one item holds more than one block. So this file:
 *
 * ```
 * - one
 *
 *   second para
 * - two
 * ```
 *
 * is spelled **tight between its items** and still arrives fully wrapped.
 * An attribute read off the wrapper would call it loose and the serializer
 * would write a blank line the file never had — measured at 26 bytes in and
 * 27 out, which is the mirror image of the exception being removed and lived
 * in the same function. So what is read here is the file's own spacing: a
 * blank line at the end of an item that is not the last.
 *
 * ── Read from the renderer, so there is nothing to pair (#200) ──
 *
 * This used to detect every list of the document into an array and pair that
 * array with `querySelectorAll('ul, ol')` by document order, writing nothing
 * at all when the two counts disagreed. The refusal was correct — a spelling
 * attached to the wrong list is worse than no spelling — and it was silent,
 * and it cost the **whole document** rather than the one list it could not
 * place: a `<details>` block holding a hand-written `ul` made the counts
 * disagree, and every loose list in that file came back tight. Measured at
 * the editor level: 78 bytes in, 20 out.
 *
 * There is nothing to pair now. `marked` hands its list renderer the token
 * for the list it is rendering, and that token carries the `raw` of each of
 * **its own** items, so the attribute is written by the code that is looking
 * at the bytes. The same route `blockquote-spacing.ts` takes for #199 and
 * `image-spelling.ts` for #229. Nesting falls out of it: a nested list is a
 * second call with its own items, measured over four nested shapes.
 *
 * A list that reaches the HTML without passing this renderer — one the file
 * wrote as raw HTML, which `marked` emits as an `html` token — is left with
 * no attribute, which is the tight spelling. That is the same answer it got
 * before, and now it is the answer for that list alone.
 */
export const LIST_SPACING_ATTRIBUTE = 'data-loose';

/** A blank line ending an item — the file's own spacing, not CommonMark's. */
const ENDS_WITH_BLANK_LINE = /\n[ \t]*\n$/;

/** As much of a `marked` list item as the spelling is read from. */
interface ListItemRaw {
  readonly raw?: string;
}

/**
 * Whether this list is spelled loose: any item but the last ends with a blank
 * line. The last item is excluded because a blank line after it separates the
 * list from whatever follows rather than one item from another.
 */
function isSpelledLoose(items: readonly ListItemRaw[]): boolean {
  if (items.length < 2) return false;
  return items.slice(0, -1).some((item) => ENDS_WITH_BLANK_LINE.test(item.raw ?? ''));
}

/**
 * The attribute to write on this list, as a string ready for the tag, or an
 * empty string when there is nothing to say.
 *
 * Nothing is written for a tight list: that is what the serializer does
 * without being told, so an absent attribute and an explicit tight one would
 * mean the same thing and one of the two would eventually drift. Same rule as
 * `blankMarkerAttribute` in `blockquote-spacing.ts`, and for the same reason.
 *
 * The value holds no character an attribute has to escape — it is the literal
 * `true` — so the tag is assembled without an escape step.
 */
export function listSpacingAttribute(items: readonly ListItemRaw[]): string {
  return isSpelledLoose(items) ? ` ${LIST_SPACING_ATTRIBUTE}="true"` : '';
}
