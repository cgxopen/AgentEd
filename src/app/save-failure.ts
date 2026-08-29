/**
 * What the user reads when a document could not be written to disk
 * (#171).
 *
 * Its own module for the reason #61 drew the seam and #127 followed it:
 * the platform reports that a write did not happen, and the words for it
 * belong in the app layer. Exported so a test reads what the user reads
 * rather than a copy of it (the #50 precedent).
 */

/** The dialog's title. */
export const SAVE_FAILED_TITLE = 'Document not saved';

/**
 * The English scaffold `tauri-plugin-fs` wraps around the operating
 * system's own words, in both of the places a save can fail:
 *
 *   failed to open file at path: {path} with error: {io error}
 *   failed to write bytes to file at path: {path} with error: {io error}
 *
 * Splitting on it is **not** the locale-dependent mistake `entryPresence`
 * refuses to make. That comment is about reading the *operating system's*
 * text, which is translated into its own language; this marker is a Rust
 * `format!` written by the plugin's authors and is the same string in
 * every locale. What follows it is the half that translates, and the half
 * worth showing.
 */
const CAUSE_MARKER = ' with error: ';

/** `std::io::Error` renders itself as `{message} (os error {code})`. */
const OS_ERROR_CODE = /\s*\(os error \d+\)$/;

/**
 * The operating system's own sentence about why the write failed, or
 * `null` when the error carries nothing worth showing.
 *
 * **Why this is shown at all**, when #127 chose to show no cause: there,
 * both measured causes reached one exit and neither could be told from
 * the other, so naming one would have been a confident wrong sentence.
 * Here the platform hands us the answer already distinguished. Measured
 * on Windows for the six codes this path reaches, five of the six name
 * the cause *and* imply the remedy — `The process cannot access the file
 * because it is being used by another process`, `There is not enough
 * space on the disk`, `The device is not ready` — and those are different
 * remedies. Only `Access is denied` says little, and it says it harmlessly.
 *
 * **Why only the tail.** The scaffold above is developer English that
 * stays English in every locale, and it repeats the path the sentence
 * before it already named — the objection #127 spent a measurement on.
 * The trailing `(os error 32)` is for a bug report, not for a reader.
 *
 * **The fallback is the whole message, not silence.** A web-build
 * `DOMException` carries no marker, and neither would a future plugin
 * that changes its wording. Losing the shape must degrade to showing too
 * much, never to showing nothing.
 */
export function saveFailureCause(error: unknown): string | null {
  const text = (error instanceof Error ? error.message : String(error)).trim();
  const marker = text.lastIndexOf(CAUSE_MARKER);
  const tail = marker === -1 ? text : text.slice(marker + CAUSE_MARKER.length);
  const cause = tail.replace(OS_ERROR_CODE, '').trim();
  return cause.length > 0 ? cause : null;
}

/**
 * The body, for a document that could not be written at `path`.
 *
 * **It says nothing about the file on disk, deliberately.** The obvious
 * reassurance — that the file is untouched — is not something this layer
 * can promise. The plugin opens the target with `truncate: true`, so a
 * failure at the *open* leaves the file exactly as it was, while a
 * failure during the *write* (a full volume, a drive pulled mid-save)
 * leaves it truncated or half-written. Both arrive here as one throw and
 * cannot be told apart, so the sentence claims neither. What is true in
 * every case is what it says instead: the work is still in the editor.
 *
 * **It names two remedies, because both were measured to work** from the
 * failed state — a plain Ctrl+S once the cause is gone, and a Save As to
 * a different folder or volume, which genuinely acquires a different
 * destination the way #46's did. This is the #127 rule reaching the
 * opposite answer on a different measurement, not a departure from it:
 * there, nothing in the application changed the answer, so nothing was
 * offered.
 *
 * **The path, not the name**, for #127's reason: two files can share a
 * name, and the path is where the write was attempted.
 */
export function saveFailedMessage(path: string, cause: string | null): string {
  const state =
    `AgentEd could not write ${path} to disk. ` +
    'Your work is still here in the editor, and none of it has been lost.';
  const remedy = 'Press Ctrl+S to try again, or use Save As to write the document somewhere else.';
  return cause === null ? `${state}\n\n${remedy}` : `${state}\n\n${cause}\n\n${remedy}`;
}
