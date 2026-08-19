import type {
  ImageInsertOutcome,
  ImageInsertRefusal,
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

function refusalMessage(refusal: ImageInsertRefusal): string {
  switch (refusal.reason) {
    case 'too-large':
      return imageTooLargeMessage(refusal.sizeBytes, refusal.limitBytes);
    case 'no-free-name':
      return NO_FREE_IMAGE_NAME;
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

      default: {
        // Exhaustive by construction: a new outcome kind cannot be added
        // without deciding here what the user hears about it.
        const unhandled: never = outcome;
        console.error('[agented] unreported image insert outcome:', unhandled);
      }
    }
  };
}
