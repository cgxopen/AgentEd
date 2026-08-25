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
 * all (#46).
 *
 * **It names the step, because the step exists.** Measured on the web
 * build: `pickSavePath` calls the directory picker straight after the
 * save picker, and with that handle `mkdir`, `writeBinary` and `exists`
 * all work on `assets/`. So "use Save As" is advice that leads somewhere
 * — which is the whole test a message like this has to pass, and the
 * reason the wording could not be written before the measurement.
 *
 * **No `NO_DIR_HANDLE`.** That string is in four throw sites in
 * `web.ts` and none of it is written for a person; a message quoting it
 * would be an error code wearing a sentence. "Folder access" is what the
 * browser itself calls the thing the user granted or did not.
 */
export function imageInsertUnavailableMessage(reason: ImageInsertUnavailableReason): string {
  switch (reason) {
    case 'no-folder-access':
      return 'AgentEd needs access to this document\u2019s folder to save images. Use Save As to choose where it lives, then insert the image again.';
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
 * points — paste, drop and Insert Media — share it, so a refusal is
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
