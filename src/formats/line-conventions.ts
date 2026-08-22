/**
 * A file's line conventions: how its lines end, and whether the last
 * one is terminated. They are a property of the **file**, not of the
 * editor — read at the moment AgentEd learns what the file contains,
 * and re-applied to the whole text at the moment it writes it (#79).
 *
 * They live here, one layer outside serialization: TipTap and the
 * markdown serializer emit their own convention (`\n`, no final
 * newline) and know nothing about the file. Re-imposing the file's
 * convention on the assembled text keeps the round-trip promise (R-C2)
 * without reaching into the parser or the serializer.
 */
export interface LineConventions {
  /** What every line in the written text ends with. */
  readonly lineTerminator: '\r\n' | '\n';
  /** Whether the written text ends with one terminator. */
  readonly finalNewline: boolean;
}

/**
 * What a document that was never read from disk is written with — New,
 * and New from Template. `\n` with a final newline: the convention of
 * every tool that writes markdown, and of every file in this
 * repository.
 */
export const DEFAULT_LINE_CONVENTIONS: LineConventions = {
  lineTerminator: '\n',
  finalNewline: true,
};

/**
 * Read the conventions of `text` — the text exactly as it came off the
 * disk, before any splitting.
 *
 * **The first terminator decides the whole file.** A file mixing `\r\n`
 * and `\n` is written back with the first one throughout; preserving a
 * per-line mix would mean carrying a terminator per line through
 * ProseMirror, which is the reach into serialization #79 exists to
 * avoid. Recorded as a known exception in R-C2.
 *
 * A lone `\r` (classic Mac, pre-2001) is not a convention AgentEd
 * detects: such a file contains no `\r\n`, so it is read — and written
 * — as `\n`.
 */
export function detectLineConventions(text: string): LineConventions {
  const first = text.indexOf('\n');
  const crlf = first > 0 && text.charCodeAt(first - 1) === 13; // '\r'
  return {
    lineTerminator: crlf ? '\r\n' : '\n',
    finalNewline: text.endsWith('\n'),
  };
}

/**
 * Impose `conventions` on `text`, whatever it currently uses.
 *
 * Normalises before it imposes, which is what makes it idempotent and
 * what handles the one place a `\r` survives today: `splitFrontmatter`
 * strips `\r` only at the fence boundaries, so the raw frontmatter of a
 * CRLF document still carries `\r\n` inside it, and appending a `\r` to
 * every `\n` would produce `\r\r\n` there.
 *
 * A text with no content has no line to terminate, so an empty document
 * is written as an empty file rather than as a single newline.
 */
export function applyLineConventions(text: string, conventions: LineConventions): string {
  const normalized = text.replace(/\r\n/g, '\n');
  // Exactly one final terminator, or none — never the run the text
  // happened to end with. The editor cannot represent trailing blank
  // lines anyway (measured on #79), so the run is already gone by the
  // time the text is assembled.
  const trimmed = normalized.replace(/\n+$/, '');
  if (trimmed.length === 0) return '';

  const terminated = conventions.finalNewline ? `${trimmed}\n` : trimmed;
  return conventions.lineTerminator === '\n'
    ? terminated
    : terminated.replace(/\n/g, conventions.lineTerminator);
}
