/**
 * What the user reads when a document could not be opened (#127).
 *
 * Its own module for the reason #61 drew the seam: the platform layer
 * reports that a read did not happen, and the words for it belong here.
 * Exported so a test reads what the user reads rather than a copy of it
 * (the #50 precedent).
 */

/** The dialog's title. */
export const OPEN_FAILED_TITLE = 'This file could not be opened';

/**
 * The body, for a document the application could not open at `path`.
 *
 * **It names no cause as fact.** Both causes measured on #127 — the
 * entry is gone, and the access to it is gone — arrive at this same
 * exit, and neither can be told from the other here. So the sentence
 * offers both as possibilities and asserts neither. Saying "it was
 * deleted" about a file behind a permission that lapsed is the kind of
 * confident wrong sentence #58 spent a measurement avoiding.
 *
 * **It offers no step.** There is no refresh in the sidebar, and nothing
 * in the application changes the answer. #46 could name Save As because
 * Save As genuinely acquires what it promises; nothing here does, so
 * nothing is named. Advice that leads nowhere is worse than none.
 *
 * **The last sentence is a measurement, not reassurance.** On a
 * rejection `loadDocument` throws before `applyBundle` runs, and
 * `openFilePath` never clears the editor, so the document, its
 * `filePath` and its R-C14 baseline are all untouched. The user has just
 * clicked something expecting their document to be replaced; saying
 * plainly that it was not is worth one short sentence.
 *
 * **The path, not the name.** Two files can share a name, and the path
 * is what was clicked.
 */
export function openFailedMessage(path: string): string {
  return (
    `AgentEd could not open ${path}. It may have been moved, renamed or removed, ` +
    'or it may no longer be readable from here. The document you had open is unchanged.'
  );
}
