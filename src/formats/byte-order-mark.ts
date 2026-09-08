import { BYTE_ORDER_MARK } from '../platform/decode';

/**
 * Whether a file began with a byte order mark, and putting it back.
 *
 * **A property of the file, like its line terminator** - read at the
 * moment AgentEd learns what the file contains and re-applied at the
 * moment it writes it, which is the structure #79 built for line
 * conventions and this rides beside rather than beneath.
 *
 * **It is kept out of `LineConventions` on purpose.** That name says
 * how lines end, and a mark is not a line ending; widening a name to
 * hold a second contract is what #201 spent three passes measuring.
 * Two named properties on one carrier costs nothing and reads honestly.
 *
 * **Why carried rather than recorded as an exception.** A mark is valid
 * UTF-8 that was being discarded, not invalid input being substituted,
 * and it never has to enter the document model to survive - so it costs
 * none of what the exceptions recorded in R-C2 cost, which is the whole
 * reason those exist.
 *
 * The mark reaches this layer only because the platform decoder is
 * built with `ignoreBOM`; a decoder without it consumes the mark before
 * any of this runs.
 */

/** Whether `text`, exactly as it was read, begins with a mark. */
export function hasByteOrderMark(text: string): boolean {
  return text.startsWith(BYTE_ORDER_MARK);
}

/**
 * `text` without a leading mark.
 *
 * Only one is removed. A file beginning with two marks carries a real
 * zero-width no-break space after the first, which is content rather
 * than a mark, and dropping it would be the loss this module exists to
 * stop.
 */
export function stripByteOrderMark(text: string): string {
  return hasByteOrderMark(text) ? text.slice(BYTE_ORDER_MARK.length) : text;
}

/**
 * Put the mark back, or leave the text without one.
 *
 * Strips before it applies, so it is idempotent and so a body that
 * somehow arrived carrying one cannot end up with two.
 */
export function applyByteOrderMark(text: string, present: boolean): string {
  const bare = stripByteOrderMark(text);
  return present ? `${BYTE_ORDER_MARK}${bare}` : bare;
}
