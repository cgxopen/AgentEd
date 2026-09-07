/**
 * PROTOTYPE for #245 step 3 — an HTML comment carried as bytes.
 *
 * `marked` keeps a comment: it arrives as an `html` token whose `raw` is the
 * comment bytes, block when it is alone on a line and inline when it sits in
 * a paragraph — the two shapes #229 measured for an `<img>`. **DOMPurify is
 * what removes it**, measured: `marked` emits `<!-- a note -->` and the
 * sanitizer answers the empty string.
 *
 * So the comment is stamped into an attribute on an inert element while the
 * HTML is being built, the way `stampImageSources` stamps a tag. The element
 * survives the sanitizer, the editor holds it as an atom that takes no caret,
 * and the serializer writes the bytes back.
 *
 * The bytes travel `encodeURIComponent`-encoded for the reason
 * `image-spelling.ts` gives at length: the value passes through an HTML
 * attribute in a string DOMPurify then parses, and the encoding yields only
 * letters, digits and `-_.!~*'()` plus percent escapes, so no `<`, `>`, `&`
 * or `"` can appear in it whatever the comment held.
 */

/** Set on the element standing in for a comment, carrying its bytes. */
export const MARKDOWN_COMMENT_ATTRIBUTE = 'data-comment';

/**
 * Whether `text` is exactly one HTML comment and nothing else.
 *
 * Both ends are checked, and so is the absence of a second `-->`: a value
 * reaching `decodeComment` comes from an attribute in the parsed document,
 * which a hand-written `data-comment` in a user file could also have set, and
 * what this module writes back is written into the file verbatim.
 */
export function isSingleComment(text: string): boolean {
  if (!text.startsWith('<!--') || !text.endsWith('-->') || text.length < 7) return false;
  return text.indexOf('-->') === text.length - 3;
}

/** The comment bytes, in a form that cannot carry markup. */
export function encodeComment(raw: string): string {
  return encodeURIComponent(raw);
}

/**
 * The comment bytes back, or `null` when the value is not one comment.
 *
 * A malformed percent escape throws in `decodeURIComponent`. Answering `null`
 * leaves the node carrying nothing, which is the shape it would have had with
 * no attribute at all; throwing would take the document down on open.
 */
export function decodeComment(value: string | null): string | null {
  if (value === null || value === '') return null;
  try {
    const decoded = decodeURIComponent(value);
    return isSingleComment(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * The tag the comment is carried on, and it is one tag for both shapes.
 *
 * **A `wbr`, and that is measured rather than chosen for looks.** turndown
 * collapses the whitespace around an empty inline element before any rule
 * runs, so `one <span></span> two` reaches the writer as `one two`, and the
 * first build of this had a comment inside a sentence eating one of the spaces
 * beside it. A `wbr` is in turndown own list of **void** elements, and a void
 * element is neither blank nor descended into: both spaces survive, and the
 * node reaches the rule table rather than the blank hook.
 */
export const COMMENT_TAG = 'wbr';

/**
 * The carrier for a raw `html` token, or `null` when the token is not one
 * comment on its own.
 *
 * A block token may carry the blank line that followed the comment — measured,
 * `raw` for a comment between two paragraphs is the comment plus `\n\n` — so
 * trailing whitespace is trimmed off before the bytes are read. Anything else
 * an `html` token can hold, including a `<div>` that merely contains a
 * comment, is left exactly as it is today.
 *
 * ── Why a comment on its own line becomes a paragraph holding the carrier ──
 *
 * It used to be a block node of its own, and the owner manual pass found what
 * that costs: a block atom fills its line, so clicking that line **selects**
 * it, and the next character typed **replaces** the note. There was no way to
 * put the caret beside it, which is what this repair is supposed to give. A
 * paragraph has room for a caret on either side of the mark, so typing lands
 * beside the comment instead of over it, and the arrow keys walk through the
 * line rather than jumping it. One node instead of two, and the bytes are
 * unchanged: a paragraph whose only content is the carrier is written with the
 * blank lines a paragraph gets, which is the line the file gave it.
 */
export function commentCarrier(text: string, block: boolean): string | null {
  const trimmed = block ? text.replace(/\s+$/, '') : text;
  if (!isSingleComment(trimmed)) return null;
  // `wbr` is void, so it is written without a closing tag.
  const carrier = `<${COMMENT_TAG} ${MARKDOWN_COMMENT_ATTRIBUTE}="${encodeComment(trimmed)}">`;
  return block ? `<p>${carrier}</p>` : carrier;
}
