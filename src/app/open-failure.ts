/**
 * What the user reads when a document could not be opened (#127).
 *
 * Its own module for the reason #61 drew the seam: the platform layer
 * reports that a read did not happen, and the words for it belong here.
 * Exported so a test reads what the user reads rather than a copy of it
 * (the #50 precedent).
 */

import { FILE_ABSENT, READ_REFUSED } from '../platform/types';

/** The dialog's title. */
export const OPEN_FAILED_TITLE = 'This file could not be opened';

/**
 * The body, for a document the application could not open at `path`.
 *
 * **Three sentences, because there are three states** (#173). Two of
 * them are claims and the third is the refusal to make one:
 *
 *   1. the folder answered that there is nothing by that name;
 *   2. the folder refused to answer;
 *   3. **nothing established which** — and this is the original #127
 *      disjunction, unchanged, word for word.
 *
 * The third is not a leftover. It is every failure on the **desktop**,
 * where `TauriIO` has no folder handle to ask and so marks nothing, and
 * every web failure in a session that never granted a folder. A first
 * draft of this change had two sentences and sent the unmarked case to
 * the not-found one, which moved the confident wrong sentence #127 was
 * written to avoid from the platform that can now tell the states apart
 * to the one that cannot: a file locked by another program, a
 * permission that changed, a disconnected network drive — all ordinary
 * on Windows, all established as such on #171 — would have been
 * reported as possibly deleted. **Not-found is a claim, and a claim is
 * made only where something established it.**
 *
 * **No sentence names a step, and that is measured rather than
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
 * **The refused sentence still claims no cause.** It says the read was
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
 */
export function openFailedMessage(path: string, cause?: unknown): string {
  if (marked(cause, READ_REFUSED)) {
    return (
      `AgentEd could not read ${path}. The browser refused the folder rather than ` +
      'reporting the file missing, so the file may well still be there. ' +
      'The document you had open is unchanged.'
    );
  }
  if (marked(cause, FILE_ABSENT)) {
    return (
      `AgentEd could not find ${path}. It may have been moved, renamed or removed. ` +
      'The document you had open is unchanged.'
    );
  }
  return (
    `AgentEd could not open ${path}. It may have been moved, renamed or removed, ` +
    'or it may no longer be readable from here. The document you had open is unchanged.'
  );
}

/**
 * Whether the platform put `marker` on this rejection — that is, whether
 * it established the state rather than merely failing.
 *
 * **Matching a marker AgentEd writes is not the mistake `entryPresence`
 * refuses to make.** That rule is about the browser's or the operating
 * system's own prose, which translates. These strings are ours and do
 * not, and the browser's own answer was told apart one layer down by
 * `DOMException.name` — the `isNotFound` helper in `web.ts`, which is
 * the only place that question is asked.
 */
function marked(cause: unknown, marker: string): boolean {
  return cause instanceof Error && cause.message.startsWith(`${marker}:`);
}
