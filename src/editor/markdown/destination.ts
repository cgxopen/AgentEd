/**
 * A link or image destination, written so that the next reader takes each
 * ampersand as the character it is (#447).
 *
 * CommonMark decodes a character reference inside a destination, so a
 * destination that holds `javascript&colon;alert(1)` - a relative path, which
 * is what the editor read from a raw anchor spelling `&amp;colon;` - is read
 * back as `javascript:alert(1)` once it is written as markdown. Measured on
 * #20: an untouched save turned an inert link into a `javascript:` one for
 * any renderer without a sanitizer, and AgentEd itself dropped the
 * destination on the next open.
 *
 * **The ampersand is written as `&amp;`, not escaped with a backslash**, and
 * that was measured rather than chosen. CommonMark reads both as a literal
 * ampersand, but `marked` 15 drops the backslash and then writes the ampersand
 * into the `href` unescaped, so `[t](javascript\&colon;x)` still rendered as a
 * `javascript:` link there, and GitHub dropped the link altogether. Spelled
 * `&amp;colon;`, the destination renders as the text it was in `marked`, on
 * GitHub (`gh api markdown`) and in AgentEd on the next open.
 *
 * Only an ampersand that would begin a reference is written this way: a name
 * and a semicolon, or `#` and digits and a semicolon. An ordinary query
 * string, `?a=1&b=2`, is not one and is written exactly as before, so no file
 * that did not hold this shape moves. The quantifiers are bounded, the
 * longest reference name being 31 characters, so the scan stays linear.
 */
export function literalAmpersands(destination: string): string {
  return destination.replace(
    /&(?=#[0-9]{1,7};|#[xX][0-9A-Fa-f]{1,6};|[A-Za-z][A-Za-z0-9]{0,31};)/g,
    '&amp;',
  );
}

/**
 * A destination written between the parentheses of an inline link (#664):
 * each ampersand as `literalAmpersands` writes it, then each backslash and
 * each parenthesis escaped with a backslash.
 *
 * The backslash is escaped because a reader takes a backslash before a
 * parenthesis as an escape. Written with the parentheses escaped alone, an
 * address holding `x\(y` became `x\\(y`, which a reader takes as a literal
 * backslash followed by an opening parenthesis that is not escaped: GitHub
 * read no link there, and `x\)y` was read as the address `x\` followed by
 * text. Escaped as well, the backslash is read back as itself, by `marked`
 * and by cmark-gfm, and the address is the one the editor held.
 *
 * Only what the editor writes from an href goes through here. A destination
 * the file wrote and the editor keeps as bytes, carried by
 * `destination-spelling.ts`, is not respelled.
 */
export function inlineDestination(href: string): string {
  return literalAmpersands(href).replace(/[\\()]/g, '\\$&');
}

/**
 * A destination written between angle brackets, the form a destination
 * holding white space or an angle bracket needs (#664): each backslash and
 * each angle bracket escaped with a backslash.
 *
 * Inside the brackets a reader still takes a backslash before punctuation as
 * an escape, so `x y\(z` written bare came back `x y(z`, the backslash gone,
 * and an angle bracket written bare ended the destination early or made it no
 * destination at all. Measured on #664 with `marked` and cmark-gfm, on a kept
 * reference link whose label stopped resolving.
 */
export function angleDestination(href: string): string {
  return `<${href.replace(/[\\<>]/g, '\\$&')}>`;
}
