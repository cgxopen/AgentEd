import { chordLabel } from '../ui/chord-label';
import { showToast } from '../ui/toast';
import type { AppState } from './state';

/**
 * The cue itself. Kept as a constant so the test asserts the string the
 * user reads rather than a copy of it.
 *
 * Wording: it names what the user just did ("Destination set"), then the
 * one thing left to do. No jargon, and the same register as the assets/
 * dialog reworded in #45 — "It will be created when you save the
 * document". "the document and its images" is deliberate: both are still
 * only in memory, and the image is what the user was working on.
 */
export const DESTINATION_CUE = `Destination set — press ${chordLabel('Ctrl+S')} to save the document and its images.`;

/**
 * Build the "an image just landed" notifier for the image-insert flow (#48).
 *
 * Inserting an image into a document that has never been saved asks the
 * user where the document should live — and then, correctly, writes
 * nothing: the `.md`, the `assets/` folder and the image all appear at
 * the first real save (#14, #45, R-C5). Naming a destination reads as a
 * commitment, so the silence afterwards reads as a failure. This closes
 * that gap with a message and nothing else — **no write moves, and none
 * is added** (R-C3).
 *
 * It lives here rather than in `requestSaveAs` because that function is
 * shared with Save As, where the save follows on the spot and "press
 * Ctrl+S" would be wrong.
 *
 * Silent when there is nothing to explain: a document already on disk
 * (`isFirstSave === false`) has no pending destination, and the cue is
 * shown once per document — three pasted images are one explanation, not
 * three toasts.
 */
export function createDestinationCue(state: AppState): () => void {
  return function showDestinationCue(): void {
    if (!state.isFirstSave) return;
    if (state.destinationCueShown) return;
    state.destinationCueShown = true;
    showToast(DESTINATION_CUE);
  };
}
