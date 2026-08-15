import type { CloseGuard, PlatformIO } from '../platform/types';
import { showToast } from '../ui/toast';
import type { DocumentActions } from './document-actions';
import type { AppState } from './state';

/** Shown when ✕ arrives mid-write; the toast fades on its own. */
export const SAVING_CLOSE_MESSAGE = 'Saving — try closing again in a moment.';

/**
 * Route window close and app quit through the unsaved-changes gate (R-C3).
 *
 * The in-app destructive actions (New / Open / Close file) already ask
 * before dropping unsaved work; the window's own close button, Alt+F4 and
 * app quit went straight past it. This installs the same gate on that path,
 * so there is no way out of the app that skips the save / discard / cancel
 * decision.
 *
 * Re-entrancy matters here: while the dialog is open the user can hit ✕
 * again, and the platform will emit another close request. A second dialog
 * would stack on the first and answer for a decision the user never made,
 * so repeat requests are refused while one is pending. That refusal needs no
 * message — the dialog the user is looking at already explains itself.
 *
 * A save in flight is refused too, and this one is announced. The window
 * must not exit mid-write, but a ✕ that does nothing at all reads as a
 * frozen app; on a network drive or a large document the write is long
 * enough to notice, and a user who cannot close an app tends to kill the
 * process — exactly what this gate exists to prevent. The message is a
 * toast that fades by itself: nothing is queued, because a queued close
 * would answer a decision the user has not made.
 */
export function createCloseGuard(state: AppState, docActions: DocumentActions): CloseGuard {
  let pending = false;

  return {
    hasUnsavedChanges: () => state.modified,

    async confirmClose(): Promise<boolean> {
      if (state.isSaving) {
        showToast(SAVING_CLOSE_MESSAGE);
        return false;
      }
      if (pending) return false;
      pending = true;
      try {
        return await docActions.confirmWindowClose();
      } finally {
        pending = false;
      }
    },
  };
}

/** Build the guard and hand it to the platform layer. */
export async function installCloseGuard(
  state: AppState,
  docActions: DocumentActions,
  io: PlatformIO,
): Promise<void> {
  await io.installCloseGuard(createCloseGuard(state, docActions));
}
