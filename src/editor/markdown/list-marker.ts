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
