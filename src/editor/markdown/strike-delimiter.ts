/**
 * A strikethrough the file wrote with one tilde, written back with one
 * (#744, owner decision of 2026-11-17).
 *
 * GFM spells a strikethrough with one tilde or two, `~gone~` or `~~gone~~`,
 * and `serialize.ts` wrote every one with two: the same rendering, other
 * bytes, the R-C2 exception measured in #85.
 *
 * ── Read from the token, carried on the mark ──
 *
 * The delimiter is lost at serialization, never at parse: `marked` hands each
 * `del` token its `raw`, whose opening run is the delimiter. The strike mark
 * holds no memory of it, so it travels as an attribute, the route #566 gave
 * the delimiter of an emphasis (`emphasis-delimiter.ts`).
 *
 * **Only a file.** The attribute is stamped only where the parse keeps raw
 * HTML, which is a file and never a paste, as `heading-spelling.ts` stamps
 * its own; it is one of the stamped attributes a pasted page cannot supply
 * (#447). So a strike made in the editor, by the toolbar, a shortcut, an input
 * rule or a paste, carries none and is written with two tildes, as before.
 *
 * ── Checked at save ──
 *
 * One tilde closes at the first tilde after it that follows a character
 * other than white space, so it holds less than two do: `~a~b~` is a strike
 * over `a` and then text, where `~~a~b~~` is one strike. An edit can type a
 * tilde into the struck text, or white space at its edge. So one tilde is
 * written only where the expression `marked` reads one with reads the strike,
 * written with one, as one strike over the whole text, and two are written
 * otherwise, the spelling of before.
 *
 * What stands beside the strike is not asked. Measured on `marked` 15 for a
 * tilde, a strike, a strong emphasis, an image and a link on either side, one
 * tilde and two read back alike in every case: where one fails, beside a
 * tilde or another strike, two fail the same way.
 */

/** Set on a strikethrough the file wrote with one tilde. */
export const STRIKE_DELIMITER_ATTRIBUTE = 'data-strike-delimiter';

const ONE_TILDE = '~';
const TWO_TILDES = '~~';

/** The attribute for the tag of a `del` token, or nothing for two tildes. */
export function strikeDelimiterAttribute(raw: string, fromAFile: boolean): string {
  if (!fromAFile || !raw.startsWith(ONE_TILDE) || raw.startsWith(TWO_TILDES)) return '';
  return ` ${STRIKE_DELIMITER_ATTRIBUTE}="${ONE_TILDE}"`;
}

/** The mark attribute, read from the element and rendered back onto it. */
export function strikeDelimiterMarkAttribute() {
  return {
    delimiter: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(STRIKE_DELIMITER_ATTRIBUTE) === ONE_TILDE ? ONE_TILDE : null,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.delimiter === ONE_TILDE ? { [STRIKE_DELIMITER_ATTRIBUTE]: ONE_TILDE } : {},
    },
  };
}

/** The `del` of `marked` 15, for one tilde: it closes where `marked` would. */
const ONE_TILDE_STRIKE = /^~(?=[^\s~])(?:\\.|[^\\])*?(?:\\.|[^\s~\\])~(?=[^~]|$)/;

/** The delimiter to write `node` with, around `content`, its markdown already written. */
export function strikeDelimiter(node: Node, content: string): string {
  const element = node as HTMLElement;
  if (element.getAttribute?.(STRIKE_DELIMITER_ATTRIBUTE) !== ONE_TILDE) return TWO_TILDES;
  const written = `${ONE_TILDE}${content}${ONE_TILDE}`;
  // The strike must close at its own last tilde, not at one inside it.
  return ONE_TILDE_STRIKE.exec(written)?.[0].length === written.length ? ONE_TILDE : TWO_TILDES;
}
