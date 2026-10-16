import { marked } from 'marked';

/**
 * What an inline link wrote between its parentheses (#573, owner decision B
 * of 2026-10-16 on the step zero).
 *
 * The link mark holds its href as the DOM decodes it, and its title, and
 * `serialize.ts` writes the destination back from that: so `</my uri>` came
 * back `/my%20uri`, `wiki/București` came back `Bucure%C8%99ti`, a path with
 * balanced parentheses came back with them escaped, and `/f&ouml;` came back
 * `/föö`: the same link, other bytes, and two CommonMark examples that moved
 * again on the second save.
 *
 * ── Read from the token, carried on the mark ──
 *
 * `marked` hands each `link` token its `raw`, which ends with the parentheses
 * the file wrote. What stands between them, the destination, the spacing and
 * the title, travels as one attribute on the mark, the route
 * `heading-spelling.ts` gives a heading. The whole of it, not the destination
 * alone: the title of a link is a spelling too (example 22 escapes a star in
 * it), and a carried destination beside a rewritten title would be half a
 * spelling. #562 keeps the delimiter of a title for a link that carries
 * nothing.
 *
 * **Only a file.** The attribute is stamped only where the parse keeps raw
 * HTML, which is a file and never a paste. An image carries nothing, nor do a
 * reference link, an autolink and a link kept as bytes, which have no
 * parentheses or are written by a route of their own (#570, #567, #564).
 *
 * ── What is not carried ──
 *
 * A spelling holding a line ending, a destination and a title on two lines
 * (example 510), is written on one line as before: written into a quote or a
 * list item it would need the prefix of its container on the second line.
 *
 * ── Checked at save ──
 *
 * The question is put to the reader rather than to the spelling: the carried
 * text is written only where the link it makes, read by the parse the editor
 * uses, has the href and the title the editor holds. An address changed in
 * the link dialog, or a title changed, makes another link, so the link is
 * written from what the editor holds, as before. The dialog keeps the
 * attribute on the mark, since `setMark` merges attributes; the check is the
 * guard that refuses it.
 *
 * Inside a table cell, `marked` hands the link a `raw` whose escaped pipes are
 * already unescaped, and the cell writes each pipe escaped again; one escaped
 * outside a table cannot be written into a cell that way, below.
 */

/** Set on a link the file wrote inline: what stood between its parentheses, encoded. */
export const LINK_DESTINATION_ATTRIBUTE = 'data-link-destination';

/** The href and title a link reads as, by the parse the editor uses. */
export interface ReadLink {
  readonly href: string | null;
  readonly title: string | null;
}

/** What stands between the parentheses that end `raw`, or null where it is not an inline link. */
function insideOf(raw: string): string | null {
  if (!raw.startsWith('[') || !raw.endsWith(')')) return null;
  const at = raw.lastIndexOf('](');
  if (at < 0) return null;
  const inside = raw.slice(at + 2, -1);
  return inside.includes('\n') || inside.includes('\r') ? null : inside;
}

/** A destination the serializer writes as it stands: ASCII, with nothing it escapes or encodes. */
const PLAIN_DESTINATION = /^[A-Za-z0-9\-._~:/?#@!$+,;=%*']+$/;
/** A title it writes as it stands, in double quotes. */
const PLAIN_TITLE = /^[^"\\&\n\r]*$/;

/**
 * Whether the link is written back as the file wrote it with no carry: a
 * plain destination, alone or with a plain title in double quotes after one
 * space. Most links are, and they carry nothing, so the check at save, which
 * reads each carried link through the whole parse, costs only where a
 * spelling is kept. Measured on the 2000 links of the timing file of #573.
 */
function writtenAlike(inside: string): boolean {
  const titled = /^(\S+) "([^"]*)"$/.exec(inside);
  if (titled) return PLAIN_DESTINATION.test(titled[1] ?? '') && PLAIN_TITLE.test(titled[2] ?? '');
  return PLAIN_DESTINATION.test(inside);
}

/**
 * The attribute for the tag of a `link` token, or nothing. The split of `raw`
 * is confirmed by `marked` itself: the parentheses found must make the link
 * the token is, with its href and its title, or nothing is carried.
 */
export function linkDestinationAttribute(
  raw: string,
  href: string,
  title: string | null | undefined,
  fromAFile: boolean,
): string {
  if (!fromAFile) return '';
  const inside = insideOf(raw);
  if (inside === null || writtenAlike(inside)) return '';
  const read = marked.Lexer.lexInline(`[x](${inside})`)[0] as
    | { type?: string; href?: string; title?: string | null }
    | undefined;
  if (read?.type !== 'link' || read.href !== href || (read.title ?? null) !== (title ?? null)) {
    return '';
  }
  // Encoded, since the sanitizer trims an attribute value and the spacing is half of it.
  return ` ${LINK_DESTINATION_ATTRIBUTE}="${encodeURIComponent(inside)}"`;
}

/** The spelling an attribute value encodes, or null where it encodes none. */
function insideFrom(value: string | null): string | null {
  if (value === null) return null;
  try {
    const decoded = decodeURIComponent(value);
    return /[\n\r]/.test(decoded) ? null : decoded;
  } catch {
    return null;
  }
}

/** The mark attribute, read from the element and rendered back onto it. */
export function linkDestinationMarkAttribute() {
  return {
    destination: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        insideFrom(element.getAttribute(LINK_DESTINATION_ATTRIBUTE)),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.destination === 'string'
          ? { [LINK_DESTINATION_ATTRIBUTE]: encodeURIComponent(attributes.destination) }
          : {},
    },
  };
}

/**
 * The parentheses of `link` as the file wrote them, or null where it carries
 * none or they would make another link. `read` is the parse the editor uses,
 * asked about the markdown of one link; `inACell` says whether a table cell
 * writes it, which the serializer knows and the element may not, since a cell
 * is written from its own markup.
 */
export function keptDestination(
  link: HTMLElement,
  read: (markdown: string) => ReadLink | null,
  inACell: boolean,
): string | null {
  const inside = insideFrom(link.getAttribute(LINK_DESTINATION_ATTRIBUTE));
  if (inside === null) return null;
  // A cell escapes every pipe it writes, so a pipe the spelling already
  // escapes, carried by a link copied in from outside a table, would be
  // escaped twice and end the cell there: the table read back another way.
  // A link the file wrote in a cell arrives with its pipes unescaped.
  if (inACell && /\\\|/.test(inside)) return null;
  const made = read(`[x](${inside})`);
  const title = link.getAttribute('title');
  if (made === null || made.href !== link.getAttribute('href')) return null;
  if ((made.title ?? '') !== (title ?? '')) return null;
  return `(${inside})`;
}
