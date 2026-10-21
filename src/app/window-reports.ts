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
 * It also reports the colour of its page, which the process draws behind
 * every window it shows next, so a window is in the palette before its page
 * has painted (#645). That colour changes with the theme, so the report is
 * sent again whenever `data-theme` on `<html>` changes, a change of the
 * system under Auto included.
 *
 * Reported at once and again whenever the name, the unsaved mark or the
 * theme changes.
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
  page: PageColour = documentPageColour,
): void {
  let name = 'Untitled';
  let failed = false;

  const report = (): void => {
    reportWindowState({
      title: name,
      unsaved: state.modified,
      untouched: state.filePath === null && !state.modified,
      background: page.read(),
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
  page.onChange(() => report());
  onCoordinated(report);
}

/** Where the colour of the page is read, and told when it may have changed. */
export interface PageColour {
  read(): string;
  onChange(cb: () => void): void;
}

/** The page of this document: `--bg` on `<html>`, which `data-theme` sets. */
export const documentPageColour: PageColour = {
  read: () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  onChange: (cb) => {
    new MutationObserver(cb).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  },
};
