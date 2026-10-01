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
