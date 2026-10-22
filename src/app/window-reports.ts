import { onCoordinated, reportWindowState } from '../platform/window-coordination';
import type { AppState } from './state';

/**
 * What this window reports to the process once it is one of several, on
 * macOS (#559): its document name, which becomes the window title the Window
 * menu and the Dock list; whether it holds unsaved changes, which a quit
 * asks about one window at a time; and whether it is an empty Untitled
 * document never edited, which a document opened from Finder takes instead
 * of a new window (owner decision on #559).
 *
 * Reported at once and again whenever the name or the unsaved mark
 * changes. The colour of the page reaches the process on its own, on every
 * platform (`page-colour.ts`, #648).
 * Nothing is reported on Windows or Linux, where the process never says the
 * window is one of several (`platform/window-coordination.ts`).
 *
 * **A failed report is shown, once.** The process counts a window that has
 * never reported as holding unsaved changes, but one whose later report was
 * lost keeps what it last said, and a quit with nothing unsaved is approved
 * at once. So the person is told to save before quitting rather than left
 * to find out.
 */
export function setupWindowReports(
  state: AppState,
  onFilenameChange: (cb: (name: string) => void) => void,
  showFailure: (error: unknown) => void,
): void {
  let name = 'Untitled';
  let failed = false;

  const report = (): void => {
    reportWindowState({
      title: name,
      unsaved: state.modified,
      untouched: state.filePath === null && !state.modified,
    }).catch((e: unknown) => {
      console.error('[window-reports] report failed:', e);
      if (failed) return;
      failed = true;
      showFailure(e);
    });
  };

  // The name is followed from the first moment, so the first report after
  // coordination already carries the document a cold start opened.
  onFilenameChange((shown) => {
    name = shown;
    report();
  });
  state.onModifiedChange(() => report());
  onCoordinated(report);
}
