import type { SidebarGesture } from '../preferences';
import type { Sidebar, SidebarGestures } from '../ui/sidebar';

/**
 * The files panel at a start (#788, owner decision of 2026-11-24): when the
 * last gesture on it was an open by hand and the document that opens has a
 * file, it opens as if its control had been pressed, once the document is
 * loaded.
 *
 * **A start is the first document the system hands this window**, and this
 * wraps the one door it comes through, the open `setupFileAssociation` is
 * given: a launch with a file from the file manager or the command line, a
 * window of its own opened from a link (#731), which is a launch with the path
 * as its argument on Windows and Linux and a new window taking its held path on
 * macOS, and a file macOS hands to the running application, which goes to an
 * untouched Untitled window or a new one (#559). A launch with no file never
 * uses the door, so the empty Untitled document keeps the panel shut. The web
 * build has no such door, since `setupFileAssociation` installs nothing there,
 * so it never opens the panel on its own.
 *
 * **Asked once, and only after the document is on screen.** The first path is
 * the start and every later one is not; the open is asked when the open of the
 * document has resolved, so the document is in the editor and its arrival has
 * drawn whatever it draws. An arrival that raised the panel for an `assets/`
 * folder has drawn the same view an open by hand draws (#750), so the panel is
 * left as it is and the folder is read once. An open that failed leaves no file,
 * and nothing is asked.
 */
export interface PanelAtStartDeps {
  /** The open of a document by its path, which this waits for. */
  readonly open: (path: string) => Promise<void>;
  /** The last gesture on the panel, read at the start rather than before it. */
  readonly remembered: () => SidebarGesture | null;
  /** The file of the document on screen, null for an Untitled document. */
  readonly filePath: () => string | null;
  readonly panel: Pick<Sidebar, 'isVisible'> & Pick<SidebarGestures, 'openAsIfPressed'>;
}

export function openPanelAtStart(deps: PanelAtStartDeps): (path: string) => Promise<void> {
  let started = false;
  return async (path) => {
    const isStart = !started;
    started = true;
    await deps.open(path);
    if (!isStart || deps.remembered() !== 'open') return;
    if (deps.filePath() === null || deps.panel.isVisible()) return;
    deps.panel.openAsIfPressed();
  };
}
