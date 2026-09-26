/**
 * Whether the document differs from what was last saved or opened (#441).
 *
 * ── The rule, owner decision of 2026-09-26 ──
 *
 * **The document is modified exactly when its editor content differs from
 * the snapshot, or its metadata string differs from the snapshot, or a save
 * left images unwritten.** An undo or a hand edit back to the saved state
 * therefore clears the mark, and redo away from it sets it again (R-C3).
 *
 * ── Why the editor document, and not the text ──
 *
 * Measured on #441 in Chromium 153 on a Ryzen 9 3900: assembling the text
 * and comparing it with the disk text cost 43.8 ms per keystroke on
 * `STATUS.md` (227 KB) and 492.7 ms at 1.8 MB, where `countDocument`, the
 * #215 yardstick, cost 2.2 and 23.6. Comparing two editor documents with
 * `Node.eq` cost 0.40 and 2.20 ms. Comparing undo depths instead was
 * rejected on a figure: after save, undo and a different edit of the same
 * length, the depth matched the save and the text did not, which reported
 * unsaved work as saved.
 *
 * `Node.eq` is structural, so it is stricter than the text: where the two
 * would disagree it keeps the mark on, which is the direction R-C3 allows.
 *
 * ── The two states the editor document cannot see ──
 *
 * - **Images a save could not write** (R-C5, #46): the `.md` is on disk and
 *   matches, its pictures are only in memory. `imagesPending` keeps the mark
 *   on until a save writes them, whatever the comparison says.
 * - **A document never saved** compares against the empty document it was
 *   created as. A template seed is applied after that snapshot, so a seed
 *   with content is marked and Blank Document is not (R-C18), and no undo
 *   can take a seed away, because every document replacement drops the undo
 *   history (`forgetUndoHistory`, #206).
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** What was last written to disk, read from it, or created empty. */
export interface SavedState {
  /**
   * The editor document at that moment, or `null` where no editor was
   * there to read - an `AppState` built without one, as some tests build it.
   */
  readonly doc: ProseMirrorNode | null;
  /** The metadata block exactly as it was written or read. */
  readonly frontmatter: string | null;
  /** Whether that save left pictures in memory that are not on disk. */
  readonly imagesPending: boolean;
}

/** The document as it is now, in the same two parts. */
export interface CurrentDocument {
  readonly doc: ProseMirrorNode | null;
  readonly frontmatter: string | null;
}

/**
 * The rule above, as a pure function. With no snapshot at all nothing is
 * known to be saved, so the document is modified.
 *
 * Where either side has no editor document the body cannot be compared, and
 * only the metadata and the pending images decide. In the application both
 * are always read from the editor (`main.ts` sets the reader before any
 * document is loaded); the gap exists for contexts built without an editor.
 */
export function differsFromSaved(current: CurrentDocument, saved: SavedState | null): boolean {
  if (saved === null) return true;
  if (saved.imagesPending) return true;
  if (current.frontmatter !== saved.frontmatter) return true;
  if (current.doc === null || saved.doc === null) return false;
  return !current.doc.eq(saved.doc);
}
