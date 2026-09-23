/**
 * A footnote, carried as the lines the file wrote (#408).
 *
 * The bracket form GitHub documents: `[^label]` where it is referenced, and
 * `[^label]: text` where it is defined, the definition optionally continuing
 * on indented lines below it.
 *
 * **Until this, every one of those shapes was damaged on save**, measured on
 * `7cd4984` and again on `651bb40`. `marked` reads a definition as a link
 * reference definition, so `[^a]: https://example.com` went into the links map
 * and came back as `[^a](https://example.com)` - a working link to a place the
 * file never linked to - while a definition whose body does not parse as a
 * destination came back escaped, `\[^a\]: …`, and two definitions on
 * consecutive lines were joined into one line.
 *
 * ── Why the definition is a node with editable content ──
 *
 * Four shapes were built and measured against the same twenty-one rows before
 * this one was chosen, and the choice was made on the figures rather than on
 * taste. Two of them - a node carrying the label and body as attributes, and
 * plain text with the escape held off - score **10 of 14** acceptance rows and
 * fail the identical four, because what separates two definitions is then
 * whatever the serializer puts between two blocks, which is a blank line. An
 * inert carrier holding the whole run of bytes scores 14 of 14 but is an atom:
 * measured, a keystroke aimed at the definition lands **beside** it and writes
 * a stray character into the file somewhere else.
 *
 * This shape is one node per definition, holding its own lines as editable
 * content, with the serializer joining consecutive definitions by a single
 * newline. It scores 14 of 14 and a caret goes where it is aimed.
 *
 * ── The indentation travels on the node, and that is load-bearing ──
 *
 * A definition that is editable holds its body as inline content, and a
 * newline in inline content is a soft break, which the serializer collapses to
 * a space - the recorded R-C2 exception, reached from an unexpected direction.
 * So a continuation line is a hard break in the content, and the indentation
 * the file used for it cannot live in the text: it travels on the node. The
 * first build of this scored 13 of 14 for want of it, the one failing row
 * being the one nobody looks at.
 */

/** The file's indentation for each continuation line, in document order. */
export const FOOTNOTE_INDENTS_ATTRIBUTE = 'data-footnote-indents';

/**
 * Whether the file left a blank line under this definition (#418).
 *
 * The serializer writes consecutive definitions a single newline apart, so a
 * run the file spelled a blank line apart came back tightened - and a run
 * spelled both ways came back uniform, which loses the distinction rather than
 * one blank line. The spelling is a property of the gap, and the gap is read
 * here because `marked` hands the definition its own trailing blank line in
 * `raw`: `[^a]: one\n\n` against `[^a]: one\n`. Measured at the lexer.
 *
 * It is stamped on the definition **above** the gap, which is the one whose
 * bytes carry it, and read by the definition below - the sibling whose lead
 * the serializer is choosing.
 */
export const FOOTNOTE_BLANK_LINE_ATTRIBUTE = 'data-footnote-blank-line';

/** Marks the element the definition is carried in. */
export const FOOTNOTE_DEFINITION_ATTRIBUTE = 'data-footnote-definition';

/**
 * One definition: the marker, the rest of its line, and any lines indented
 * under it.
 *
 * The label admits anything but `]` and a newline, which is what GitHub
 * accepts, so `[^margin-standard]` and `[^1]` are the same shape. The
 * continuation is *directly* following indented lines and nothing else - a
 * definition continued after a blank line is not matched, and comes back as
 * the paragraph it is read as today.
 */
export const FOOTNOTE_DEFINITION = /^\[\^([^\]\n]+)\]:([^\n]*)((?:\n[ \t]+[^\n]*)*)(?:\n|$)/;

/**
 * A reference, for the one narrowing this makes to the escape (#90).
 *
 * Turndown escapes `[` and `]` in every text node, so a reference came back as
 * `\[^a\]`. Held off for this shape alone: a reference is the only thing
 * `[^…]` can be at the top of a line or inside a sentence, and GitHub renders
 * the escaped and unescaped spellings differently once a definition exists.
 */
export const FOOTNOTE_REFERENCE = /\[\^([^\]\n]+)\]/g;

/**
 * The indentations, in a form that cannot carry markup.
 *
 * The value passes through an HTML attribute in a string DOMPurify then
 * parses, so it is encoded for the reason `image-spelling.ts` gives at length:
 * `encodeURIComponent` yields only letters, digits and `-_.!~*'()` plus
 * percent escapes, so no `<`, `>`, `&` or `"` can appear in it.
 */
export function encodeIndents(indents: readonly string[]): string {
  return encodeURIComponent(JSON.stringify(indents));
}

/**
 * The indentations back, or none.
 *
 * A value that does not decode answers an empty list rather than raising: it
 * cannot come from this pipeline, which encodes what it stamps, so what it
 * answers for is an attribute a user document wrote by hand.
 */
export function decodeIndents(value: string | null): string[] {
  if (value === null || value === '') return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

/** The lines of one definition, and the indentation each continuation used. */
export interface FootnoteLines {
  /** The whole definition as the file spells it, newlines and all. */
  readonly lines: string[];
  /** One entry per continuation line, so `lines.length - 1` of them. */
  readonly indents: string[];
}

/** Split a definition's raw bytes into its lines and their indentation. */
export function splitDefinition(raw: string): FootnoteLines {
  const withoutTrailingNewline = raw.replace(/\n$/, '');
  const all = withoutTrailingNewline.split('\n');
  const indents = all.slice(1).map((line) => /^[ \t]*/.exec(line)?.[0] ?? '');
  const lines = all.map((line, index) => (index === 0 ? line : line.replace(/^[ \t]*/, '')));
  return { lines, indents };
}

/** Put a definition back together from its lines and their indentation. */
export function joinDefinition({ lines, indents }: FootnoteLines): string {
  return lines
    .map((line, index) => (index === 0 ? line : `${indents[index - 1] ?? '    '}${line}`))
    .join('\n');
}
