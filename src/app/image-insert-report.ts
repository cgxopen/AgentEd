import type {
  ImageInsertOutcome,
  ImageInsertRefusal,
  ImageInsertUnavailableReason,
  ReportImageInsert,
} from '../editor/image-insert-outcome';
import { showToast } from '../ui/toast';
import { createDestinationCue } from './destination-cue';
import type { AppState } from './state';

/**
 * What the user reads when an image is too large to insert.
 *
 * Megabytes are computed here rather than in the editor layer: the
 * insert reports the two sizes as facts, and rounding them into a
 * sentence is a wording decision. The string is exported so a test reads
 * what the user reads rather than a copy of it (the #50 precedent).
 */
export function imageTooLargeMessage(sizeBytes: number, limitBytes: number): string {
  const sizeMb = Math.round(sizeBytes / 1024 / 1024);
  const limitMb = limitBytes / 1024 / 1024;
  return `Image too large (${sizeMb} MB). Max ${limitMb} MB.`;
}

/** What the user reads when every candidate name in `assets/` is taken. */
export const NO_FREE_IMAGE_NAME = 'Could not find a free file name in the assets folder.';

/**
 * What the user reads when one gesture carried more images than it may
 * hold in memory at once (#71).
 *
 * **Both counts, because the insert was partial.** Refusing part of a
 * gesture is only acceptable while the message is exact — a vague
 * sentence over a partial insert leaves the user counting thumbnails to
 * work out what happened. So it says what landed and what did not,
 * rather than "some images were skipped".
 *
 * **It names the budget, not the attempt.** "Max 128 MB of images at
 * once" is a rule the user can act on — paste fewer, or paste the rest
 * after saving; "you pasted 412 MB" is trivia about a selection they
 * made themselves. The bytes attempted travel on the outcome anyway, as
 * a fact the wording may one day want.
 *
 * Shaped deliberately like `imageTooLargeMessage` — a plain statement
 * then the limit — because the two are the same family of refusal, one
 * about a file and one about a gesture.
 */
export function imageGestureTooLargeMessage(
  inserted: number,
  refused: number,
  budgetBytes: number,
): string {
  const budgetMb = Math.round(budgetBytes / 1024 / 1024);
  const landed = inserted === 1 ? '1 image' : `${inserted} images`;
  return `Inserted ${landed}, ${refused} left out. Max ${budgetMb} MB of images at once.`;
}

/**
 * What the user reads when this document cannot hold an image here at
 * all (#46). One reason, one sentence — which is why they are written
 * here and not in the editor layer, and why a new reason cannot be added
 * without this switch refusing to compile.
 *
 * **`no-folder-access` is about *this document's* folder, and names a
 * step, because the step exists.** Two states reach it and the sentence
 * is true of both without telling them apart, which is the rule (#58,
 * #127): the web build with no folder granted at all, and — since #148 —
 * a document saved somewhere the granted folder cannot reach. The fact
 * they share is the one `canWriteCompanions` now asks about, so the
 * sentence states it and asserts no cause beyond it.
 *
 * **The step was measured from both** (#46, #148). From the first,
 * `pickSavePath` calls the directory picker straight after the save
 * picker, and with that handle `mkdir`, `writeBinary` and `entryPresence`
 * all work on `assets/`. From the second, two routes were measured and
 * both come back working: a Save As into the granted folder, and a Save
 * As that grants the folder the document is in. So "Use Save As" leads
 * somewhere from either state — the whole test a message like this has
 * to pass. It says *allow access to that folder* rather than *choose
 * where it lives*, because the document in the second state already
 * lives somewhere; what it lacks is the access.
 *
 * **It says the image was not added**, because nothing happened at all:
 * the insert refuses before the image is placed, so the document is
 * exactly as it was. The save-time twin of this state says the other
 * half — the document reached disk and its images did not — and lives in
 * `document-actions.ts`, where the save can say it.
 *
 * **`assets-folder-unreadable` states what happened, and names the one
 * step measured to change it** (#58, #125, #129). The folder is there
 * and could not be listed, and two causes arrive at this same exit with
 * no way to tell them apart here — so neither is asserted as fact.
 *
 * This sentence used to name *another program has it open* as one of
 * two things to check. That cause was never measured: #125 records that
 * no reliable way to arrange it was found on Windows, and a message is a
 * promise about where to look. It is gone rather than left standing.
 *
 * It also used to offer no step at all, on the grounds that nothing in
 * AgentEd changes the answer. #129 measured a state where something
 * does: a folder grant revoked mid-session leaves the handle in memory,
 * `canWriteCompanions` answers from the handle rather than from a
 * permission, and the insert reaches here — where a Save As re-acquires
 * the grant. So the step is named, and the sentence is honest that it
 * may not be enough: what is left when it changes nothing is a folder
 * being kept shut from outside, which is the other cause without
 * claiming to have identified it.
 *
 * **No `NO_DIR_HANDLE`, no `listDir`, no error code.** `NO_DIR_HANDLE`
 * is in four throw sites in `web.ts` and none of it is written for a
 * person; a message quoting any of that would be a mechanism wearing a
 * sentence. "Folder access" is what the browser itself calls the thing
 * the user granted or did not.
 */
export function imageInsertUnavailableMessage(reason: ImageInsertUnavailableReason): string {
  switch (reason) {
    case 'no-folder-access':
      return 'AgentEd doesn\u2019t have access to the folder this document is in, so the image wasn\u2019t added. Use Save As to allow access to that folder, then insert the image again.';
    case 'assets-folder-unreadable':
      return 'Can\u2019t read the assets folder next to this document, so the image wasn\u2019t added. Use Save As to grant folder access again; if that changes nothing, the folder is being kept shut from outside AgentEd.';
  }
}

function refusalMessage(refusal: ImageInsertRefusal): string {
  switch (refusal.reason) {
    case 'too-large':
      return imageTooLargeMessage(refusal.sizeBytes, refusal.limitBytes);
    case 'no-free-name':
      return NO_FREE_IMAGE_NAME;
    case 'gesture-too-large':
      return imageGestureTooLargeMessage(refusal.inserted, refusal.refused, refusal.budgetBytes);
  }
}

/**
 * Build the one place that decides what an image insert says (#61).
 *
 * The editor layer reports how the insert ended and nothing else; this
 * turns that into words, or into a deliberate silence. Three entry
 * points — paste, drop and Insert, Image — share it, so a refusal is
 * worded once however the image arrived.
 *
 * The success half is unchanged from #48: the destination cue, once per
 * document, only after the image has actually landed.
 */
export function createImageInsertReporter(state: AppState): ReportImageInsert {
  const showDestinationCue = createDestinationCue(state);

  return function reportImageInsert(outcome: ImageInsertOutcome): void {
    switch (outcome.kind) {
      case 'inserted':
        showDestinationCue();
        return;

      case 'cancelled':
        // Says nothing, on purpose. The user closed the destination
        // picker or declined the assets/ folder a moment ago; repeating
        // it back to them explains nothing they do not already know, and
        // #46 asks for this silence explicitly. It is a branch rather
        // than an omission so that the decision is findable — and so
        // that a cause which only *looks* like a cancellation (#51, #46)
        // has somewhere visible to stop being one.
        return;

      case 'refused':
        // The application stopped, not the user. It says why (#13).
        showToast(refusalMessage(outcome), 'warn');
        return;

      case 'unavailable':
        // The application cannot do it here at all, and nobody has told
        // the user anything — so it speaks, like a refusal. It reaches
        // this branch once per gesture rather than once per file,
        // because `insertImageGesture` treats the kind as terminal
        // (#46): the cause belongs to the document and the environment,
        // and three identical toasts about one fact is noise.
        showToast(imageInsertUnavailableMessage(outcome.reason), 'warn');
        return;

      default: {
        // Exhaustive by construction: a new outcome kind cannot be added
        // without deciding here what the user hears about it.
        const unhandled: never = outcome;
        console.error('[agented] unreported image insert outcome:', unhandled);
      }
    }
  };
}
