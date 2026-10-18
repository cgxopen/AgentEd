/**
 * A paragraph holding only `&nbsp;`, a spacer, kept through an unedited save (#606).
 *
 * `&nbsp;` alone on a line is a spacer common in READMEs: CommonMark reads it
 * as a paragraph holding one non-breaking space, and GitHub draws the gap.
 * `marked` decodes the reference, so the editor holds a paragraph of U+00A0,
 * and turndown reads a node whose text is all white space as blank, which
 * JavaScript says U+00A0 is: the paragraph wrote nothing and the gap was gone
 * after an unedited save, measured on 15 corpus files (6 distinct).
 *
 * ── Marked by the parse (owner decision 1 of 2026-10-18 on #606) ──
 *
 * A paragraph of U+00A0 is not always a spacer: `marked` 15 cuts a list item
 * before a U+00A0 that ends it and reads the character as a paragraph of its
 * own, which GitHub reads as text in the item. Keeping every such paragraph
 * wrote one GitHub never read, in 1 corpus file. So the parse marks a
 * paragraph whose source is references to a non-breaking space alone, with an
 * attribute stamped for the serializer (#447), and only a marked paragraph is
 * kept here. An edit lets it go: a letter typed beside the space makes text
 * this does not match, and the paragraph emptied holds nothing to keep.
 *
 * ── Kept through turndown ──
 *
 * Before turndown runs, each non-breaking space of a marked paragraph is
 * written as a character of the Private Use Area, which is not white space,
 * and after it each is written back as `&nbsp;`, the precedent of the code
 * span of spaces (#603). The reference and not the character: `marked` trims
 * a paragraph of U+00A0 to nothing, so the character would be lost on the next
 * open, where the reference is read back as the same paragraph. An ordinary
 * space between two of them is kept as it stands.
 *
 * A document that carries the stand-in itself is written as before, the step
 * aside of #409, #568 and #603.
 */

const SPACER = '\uE01E';
/** U+00A0, built from its code so the source shows which character it is. */
const NBSP = String.fromCharCode(0xa0);

/** A marked paragraph, any other attributes on it, whose text is non-breaking spaces and spaces. */
const SPACER_PARAGRAPH = new RegExp(
  `<p(\\s[^>]{0,2000}data-spacer[^>]{0,2000})>((?:[ ${NBSP}]|&nbsp;){1,1000})</p>`,
  'g',
);
const NON_BREAKING = new RegExp(`${NBSP}|&nbsp;`, 'g');
const HOLDS_ONE = new RegExp(`${NBSP}|&nbsp;`);

/** `html` with each spacer paragraph written in the stand-in, and the way back. */
export function keepingSpacerParagraphs(html: string): {
  html: string;
  restore: (text: string) => string;
} {
  if (html.includes(SPACER) || !(html.includes('&nbsp;') || html.includes(NBSP))) {
    return { html, restore: (text) => text };
  }
  const kept = html.replace(
    SPACER_PARAGRAPH,
    (whole, attributes: string | undefined, inner: string) =>
      HOLDS_ONE.test(inner)
        ? `<p${attributes ?? ''}>${inner.replace(NON_BREAKING, SPACER)}</p>`
        : whole,
  );
  return { html: kept, restore: (text) => text.replaceAll(SPACER, '&nbsp;') };
}

/** Set by the parse on a paragraph whose source is non-breaking space references alone. Stamped. */
export const SPACER_ATTRIBUTE = 'data-spacer';

/** The source of a spacer: references to a non-breaking space, and spaces. */
const SPACER_SOURCE =
  /^[ \t]{0,3}(?:&nbsp;|&#160;|&#[xX][aA]0;)(?:[ \t]|&nbsp;|&#160;|&#[xX][aA]0;){0,1000}\n?$/;

/** The attribute for a paragraph token whose raw is a spacer, or nothing. */
export function spacerAttribute(raw: string): string {
  return SPACER_SOURCE.test(raw) ? ` ${SPACER_ATTRIBUTE}=""` : '';
}
