/**
 * Which marker a list was written with (#431).
 *
 * ── Why this exists at all ──
 *
 * `serialize.ts` writes every bullet list with `-` and every ordered list with
 * `.`, from one turndown option. That is fine for a list alone, and it loses a
 * document when two lists sit next to each other: **a marker change is the one
 * thing in markdown that keeps two adjacent lists of the same kind apart.**
 * Written with the same marker they are one list, and measured on `6b5c2e4`
 * that is what happened - `- one`⏎`- two`⏎⏎`* three`⏎`* four` came back as one
 * list, and the **second** save wrote it loose, four items a blank line apart.
 * The comment above `adjacentListsOfDifferentKinds` in `serialize.ts` already
 * says a same-kind pair cannot be written tightly; what it did not say is that
 * the blank line it falls back to does not hold either.
 *
 * So this is not a nicety. Tight merges the pair, a blank line merges it one
 * save later, and nothing can be inserted between them that the file did not
 * have. The marker is the only spelling left.
 *
 * ── Why an attribute, and read from the raw ──
 *
 * The marker is lost at serialization, never at parse: `marked` hands us two
 * list tokens, each carrying its own marker at the head of its first item's
 * raw. By the time the document model exists the distinction is gone, the way
 * #28 found for a list's spacing, so it travels as an attribute on the list -
 * the same address, read in the same renderer, declared beside the same
 * `loose` attribute.
 *
 * ── What is deliberately not written ──
 *
 * Nothing for `-` and nothing for `.`, which are what the serializer writes
 * unasked. An absent attribute and an explicit default would mean the same
 * thing and one of the two would eventually drift - the rule
 * `listSpacingAttribute` states for a tight list, and `blockquote-spacing.ts`
 * for a blank marker.
 */

/** The marker a bullet list used, when it was not the default. */
export const LIST_MARKER_ATTRIBUTE = 'data-list-marker';

/** The three bullet markers CommonMark admits, and the one written unasked. */
const BULLET_MARKERS = ['-', '*', '+'] as const;
const DEFAULT_BULLET = '-';

/** The two ordered delimiters CommonMark admits, and the one written unasked. */
const ORDERED_DELIMITERS = [')', '.'] as const;
const DEFAULT_ORDERED = '.';

/**
 * The marker at the head of an item's raw text, or `null` where the raw is not
 * a shape this reads - a list built by an edit rather than parsed from a file
 * reaches the serializer with no attribute at all, which is the same answer.
 *
 * Bounded by construction: it looks at the first line only, and at its first
 * few characters, so no scan grows with the item.
 */
export function markerOf(raw: string, ordered: boolean): string | null {
  const firstLine = raw.slice(0, raw.indexOf('\n') === -1 ? raw.length : raw.indexOf('\n'));
  const trimmed = firstLine.replace(/^[ \t]*/, '');
  if (!ordered) {
    const marker = trimmed.slice(0, 1);
    return (BULLET_MARKERS as readonly string[]).includes(marker) ? marker : null;
  }
  const match = /^\d{1,9}([).])/.exec(trimmed);
  return match === null ? null : (match[1] ?? null);
}

/**
 * The attribute to write on this list, as a string ready for the tag, or an
 * empty string when there is nothing to say.
 *
 * The value is one character out of a closed set of five, so the tag is
 * assembled without an escape step - the reason `listSpacingAttribute` gives
 * for its own literal value.
 */
export function listMarkerAttribute(items: readonly { raw: string }[], ordered: boolean): string {
  const first = items[0];
  if (first === undefined) return '';
  const marker = markerOf(first.raw, ordered);
  if (marker === null) return '';
  const admitted = ordered ? ORDERED_DELIMITERS : BULLET_MARKERS;
  if (!(admitted as readonly string[]).includes(marker)) return '';
  if (marker === (ordered ? DEFAULT_ORDERED : DEFAULT_BULLET)) return '';
  return ` ${LIST_MARKER_ATTRIBUTE}="${marker}"`;
}

/**
 * The marker to write this list with, from whatever the node carries.
 *
 * A value the pipeline did not stamp - a `data-list-marker` a user document
 * wrote by hand - falls back to the default rather than reaching the file, for
 * the reason `decodeIndents` gives: this answers for an attribute nobody here
 * put on.
 */
export function markerFor(value: string | null, ordered: boolean): string {
  const admitted = ordered ? ORDERED_DELIMITERS : BULLET_MARKERS;
  if (value !== null && (admitted as readonly string[]).includes(value)) return value;
  return ordered ? DEFAULT_ORDERED : DEFAULT_BULLET;
}

/**
 * An ordered list numbered with one number throughout, `1.`, `1.`, `1.` (#569,
 * owner decision of 2026-10-09: repaired before 1.0.0).
 *
 * Every ordered list used to be written with its items counted up from its
 * start, so such a list came back `1.`, `2.`, `3.`: the same rendering, other
 * bytes, in 83 of 1985 public files measured by AMP on #569. Measured on 8706
 * files of this machine: 3803 ordered lists, 3136 counted up, 422 of a single
 * item, 233 with one number throughout, every one of them `1.`, and 12
 * numbered some other way, which keep being counted up.
 *
 * The style is read from the item raws `marked` hands the list renderer, as the
 * marker above is, and carried on the list beside it. A list of one item has
 * no style to read, and a list the editor makes carries none, so both are
 * counted up as before. What is shown is not touched: the editor draws an
 * ordered list from its start, so the reader sees 1, 2, 3 either way, and a
 * list continued after a paragraph keeps continuing on screen (R-C1, D1).
 */
export const LIST_NUMBERING_ATTRIBUTE = 'data-list-numbering';

/** The value for a list whose items all carry the same number. */
export const ONE_NUMBER = 'one';

/** The number at the head of an item's raw, or `null` where there is none. */
function numberOf(raw: string): number | null {
  const match = /^[ \t]*(\d{1,9})[.)]/.exec(raw);
  return match === null ? null : Number(match[1]);
}

/** The attribute to write on an ordered list whose items share one number. */
export function listNumberingAttribute(
  items: readonly { raw: string }[],
  ordered: boolean,
): string {
  if (!ordered || items.length < 2) return '';
  const first = numberOf(items[0]?.raw ?? '');
  if (first === null) return '';
  const same = items.every((item) => numberOf(item.raw) === first);
  return same ? ` ${LIST_NUMBERING_ATTRIBUTE}="${ONE_NUMBER}"` : '';
}
