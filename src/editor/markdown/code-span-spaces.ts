/**
 * A code span of white space only, kept through turndown (#603).
 *
 * turndown reads a node whose text is all white space as blank, and a blank
 * node writes nothing of its own: a span of two spaces went, and so did a
 * paragraph, a list item or a cell holding only such a span. CommonMark keeps
 * a span of spaces only as it is, so the span is content to GitHub, example
 * 138 of the CommonMark suite.
 *
 * So before turndown runs, each white-space character of such a span is
 * written as a character of the Private Use Area, which is not white space,
 * and after it the characters are written back. turndown then writes the
 * span with the run that closes it, as it writes any other.
 *
 * A document that carries one of the three characters itself is written as
 * before, the step aside the marks of #409 and #568 take, so a character the
 * person typed is never turned into a space.
 */

const SPACE = '\uE01A';
const TAB = '\uE01B';
const NO_BREAK = '\uE01C';
const ANY = /[\uE01A-\uE01C]/;
const ANY_GLOBAL = /[\uE01A-\uE01C]/g;
/** U+00A0, built from its code so the source shows which character it is. */
const NBSP = String.fromCharCode(0xa0);

/** A code span outside a fenced block whose text is white space alone, as the editor writes it. */
const SPAN_OF_SPACES = new RegExp(`(?<!<pre[^>]*>)<code>((?:[ \\t${NBSP}]|&nbsp;)+)</code>`, 'g');
const SPACE_CHARACTER = new RegExp(`[ \\t${NBSP}]`, 'g');

const WRITTEN: Readonly<Record<string, string>> = { ' ': SPACE, '\t': TAB, [NBSP]: NO_BREAK };
const READ: Readonly<Record<string, string>> = { [SPACE]: ' ', [TAB]: '\t', [NO_BREAK]: NBSP };

/** `html` with each span of white space only written in the three characters, and the way back. */
export function keepingSpansOfSpaces(html: string): {
  html: string;
  restore: (text: string) => string;
} {
  if (ANY.test(html) || !html.includes('<code>')) return { html, restore: (text) => text };
  const kept = html.replace(
    SPAN_OF_SPACES,
    (_span, inner: string) =>
      `<code>${inner.replace(/&nbsp;/g, NBSP).replace(SPACE_CHARACTER, (c) => WRITTEN[c])}</code>`,
  );
  return { html: kept, restore: (text) => text.replace(ANY_GLOBAL, (c) => READ[c]) };
}
