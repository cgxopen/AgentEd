/**
 * What the user reads when a document could not be opened (#127).
 *
 * Its own module for the reason #61 drew the seam: the platform layer
 * reports that a read did not happen, and the words for it belong here.
 * Exported so a test reads what the user reads rather than a copy of it
 * (the #50 precedent).
 */

import { READ_REFUSED } from '../platform/types';

/** The dialog's title. */
export const OPEN_FAILED_TITLE = 'This file could not be opened';

/**
 * The body, for a document the application could not open at `path`.
 *
 * **Two sentences, because there are two states and the platform can
 * now tell them apart** (#173). Until then `resolveFileHandle` returned
 * the same `null` for a file that was gone and for a read the browser
 * refused, so one sentence had to cover both and offered each as a
 * possibility. That disjunction was honest for what was known; it is
 * not what is known any more, and a user whose file is sitting exactly
 * where they left it was being told it may have been removed.
 *
 * **Neither sentence names a step, and that is measured rather than
 * omitted.** The remedy the original #173 body assumed — Save As, the
 * one R-C5 names for images — was driven from the failed state and does
 * not restore access to the folder the read was about: `pickSavePath`
 * **replaces** the grant with whatever folder the user picks in a
 * second dialog, re-anchors the document to the destination picked in
 * the first, and writes it. Naming it here would tell someone to save
 * their document somewhere else in order to read a file. #46 could name
 * Save As because Save As genuinely acquires what it promises there;
 * nothing acquires what is needed here, so nothing is named. Advice
 * that leads nowhere is worse than none (#148).
 *
 * **The second sentence still claims no cause.** It says the read was
 * refused and that this is not a missing file, which is exactly what
 * `READ_REFUSED` establishes. It does not say the grant lapsed: which
 * `DOMException` a browser raises for a lapsed grant, a revoked one, or
 * a path component that is a file has not been measured, and naming one
 * would replace a vague truth with a confident guess.
 *
 * **The last sentence of each is a measurement, not reassurance.** On a
 * rejection `loadDocument` throws before `applyBundle` runs, and
 * `openFilePath` never clears the editor, so the document, its
 * `filePath` and its R-C14 baseline are all untouched. The user has just
 * clicked something expecting their document to be replaced; saying
 * plainly that it was not is worth one short sentence.
 *
 * **The path, not the name.** Two files can share a name, and the path
 * is what was clicked.
 *
 * `cause` is the rejection that stopped the read. Absent or unmarked, the
 * not-found sentence stands: it is what every other platform failure has
 * always produced, and a state nothing established is not a state to
 * announce.
 */
export function openFailedMessage(path: string, cause?: unknown): string {
  if (isReadRefused(cause)) {
    return (
      `AgentEd could not read ${path}. The browser refused the folder rather than ` +
      'reporting the file missing, so the file may well still be there. ' +
      'The document you had open is unchanged.'
    );
  }
  return (
    `AgentEd could not find ${path}. It may have been moved, renamed or removed. ` +
    'The document you had open is unchanged.'
  );
}

/**
 * Whether the platform marked this rejection as *the read did not
 * happen, and not because the file is absent*.
 *
 * **Matching a marker AgentEd writes is not the mistake `entryPresence`
 * refuses to make.** That rule is about the browser's or the operating
 * system's own prose, which translates. This string is ours and does
 * not, and the browser's own answer was told apart one layer down by
 * `DOMException.name` — the `isNotFound` helper in `web.ts`, which is
 * the only place that question is asked.
 */
function isReadRefused(cause: unknown): boolean {
  return cause instanceof Error && cause.message.startsWith(`${READ_REFUSED}:`);
}
