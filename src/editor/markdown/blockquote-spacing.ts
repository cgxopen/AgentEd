/**
 * How a blockquote spelled its blank lines in the file it came from (#199).
 *
 * A blank line between two blocks of a quote can be written two ways, and
 * CommonMark reads both as the same blank line:
 *
 * ```
 * > first          > first
 * >                > ⟨space⟩
 * > second         > second
 * ```
 *
 * They are the same document and different bytes, which is what R-C2 is
 * about. Measured on the pipeline: the two spellings produce **byte
 * identical HTML**, so by the time the serializer is handed a document the
 * distinction is gone and no rule in it can put the file back. The
 * spelling has to be read from the file and carried, the way a list keeps
 * its spacing (#28) and a table its column widths (#93).
 *
 * ── Read from the renderer, not paired afterwards ──
 *
 * `list-spacing.ts` and `table-style.ts` both detect into an array and pair
 * it with the parsed HTML by document order, refusing to write anything
 * when the counts disagree. That refusal is silent, which is what #200 is
 * open about, and a third consumer of it would have made that worse.
 *
 * None is needed here. `marked` hands its blockquote renderer the token
 * for the quote it is rendering, and that token carries the `raw` source of
 * **that** quote — so the attribute is written by the code that is looking
 * at the bytes, and there is nothing to pair. Measured, nesting included: a
 * quote inside a quote is rendered by a second call whose `raw` is the
 * inner source with the outer marker already stripped, so each level reads
 * its own spelling with no arithmetic.
 *
 * ── What a mixed quote does ──
 *
 * One quote, one attribute, so a quote that spells one blank line bare and
 * another with a space cannot keep both. It is written with the spelling of
 * its **first** blank line, and that is a recorded R-C2 exception — the
 * same shape, and the same reason, as a file whose lines do not all end the
 * same way (#79).
 */

/** Set on a `<blockquote>` whose blank lines the file wrote as a bare marker. */
export const BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE = 'data-blank-marker';

/** The value that attribute takes. Present only when the file spelled it bare. */
export const BARE_BLANK_MARKER = 'bare';

/**
 * A blank line of a quote, as the file wrote it: a run of markers and
 * whatever follows before the newline.
 *
 * The run is `>` possibly repeated with spaces between, for a nested quote.
 * What decides the spelling is what comes after the last marker: nothing at
 * all is bare, exactly one space is the spaced form. Two or more spaces is
 * neither — that is a line with content in it, which a fenced block inside
 * the quote can legitimately hold, and it is left alone here and by the
 * serializer.
 */
const BLANK_QUOTE_LINE = /^[ \t]*>(?:[ \t]*>)*(?<trailing>[ \t]*)$/;

/**
 * How the first blank line of `raw` was spelled, or `null` when the quote
 * has none to read.
 *
 * The first is what decides, because one attribute cannot carry two
 * answers. Reading the first rather than a majority keeps the rule one a
 * user can state: a quote is written the way it opened.
 */
export function firstBlankLineSpelling(raw: string): 'bare' | 'spaced' | null {
  for (const line of raw.split('\n')) {
    const match = BLANK_QUOTE_LINE.exec(line);
    if (!match) continue;
    const trailing = match.groups?.trailing ?? '';
    if (trailing === '') return 'bare';
    if (trailing === ' ') return 'spaced';
    // Longer runs are content, not a blank line, so they say nothing about
    // how this quote spells one.
  }
  return null;
}

/**
 * Whether a quote holds blank lines spelled both ways.
 *
 * Only used to name the case in a test and in the requirement; the writer
 * needs the first spelling and nothing else.
 */
export function hasMixedBlankLineSpelling(raw: string): boolean {
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    const match = BLANK_QUOTE_LINE.exec(line);
    if (!match) continue;
    const trailing = match.groups?.trailing ?? '';
    if (trailing === '') seen.add('bare');
    else if (trailing === ' ') seen.add('spaced');
  }
  return seen.size > 1;
}

/**
 * The attribute to write on this quote, as a string ready for the tag, or
 * an empty string when there is nothing to say.
 *
 * Nothing is written for the spaced spelling: that is what the serializer
 * does without being told, so an absent attribute and an explicit spaced
 * one would mean the same thing, and one of the two would eventually drift.
 */
export function blankMarkerAttribute(raw: string): string {
  return firstBlankLineSpelling(raw) === 'bare'
    ? ` ${BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE}="${BARE_BLANK_MARKER}"`
    : '';
}
