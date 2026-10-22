import { keepPageColour } from '../platform/index';

/**
 * The colour of the page, told to the process when the theme is applied and
 * whenever it changes, on every platform (#648).
 *
 * macOS and Linux draw each window in that colour before its page paints
 * (`src-tauri/src/window_background.rs`): a hidden window is not painted, so
 * without it the first window of a process came on screen white on a Mac, and
 * grey then white under Xvfb on Linux. Windows answers the report and keeps
 * nothing, its window being hidden until the theme (#639).
 *
 * The colour changes with the theme, so it is told again whenever `data-theme`
 * on `<html>` changes, a change of the system under Auto included. It used to
 * travel with the window state of macOS, after `window-coordination`, which
 * Linux never receives; it travels on its own since #648.
 *
 * **A failed report is logged and not shown.** It costs the colour of the next
 * launch, Paper Warm or the colour last kept until the page paints, and loses
 * nothing.
 */
export function setupPageColour(
  page: PageColour = documentPageColour,
  keep: (colour: string) => Promise<void> = keepPageColour,
): void {
  const tell = (): void => {
    keep(page.read()).catch((e: unknown) => {
      console.error('[page-colour] not kept:', e);
    });
  };
  page.onChange(tell);
  tell();
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
