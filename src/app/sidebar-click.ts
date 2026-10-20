import { basename, isMarkdownPath, isPathInsideRoot } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { showToast } from '../ui/toast';
import type { DocumentActions } from './document-actions';
import { reportSystemOpenFailure } from './system-open-failure';

/**
 * Build the sidebar's file-click handler. Decision tree:
 *
 *   1. Validate the target is inside the listing root. Fail silently
 *      (console.warn for debugging, no user-facing message) — security
 *      events should not be surfaced or guess-able.
 *   2. Markdown file (`isMarkdownPath`) → reuse the existing
 *      `openFilePath` flow, which routes through the unsaved-changes
 *      safety gate, and hand it the listing root this click came from
 *      (#178) so the panel is not dissolved by the only action it
 *      offers.
 *   3. Anything else → open with the host OS via Tauri shell. The
 *      current document's editor state stays untouched in the
 *      background. Brief toast confirms the action, and one that fails
 *      says so (#448).
 *
 * **This handler knows nothing about the platform, and that is the
 * shape rather than an omission** (#146). On the web a non-markdown
 * entry is drawn with no click listener at all, so branch 3 is not
 * reached there by a route that exists — it is not reached because
 * nothing calls this. Telling the platforms apart here instead would
 * put the desktop's behaviour behind a condition, where it is now
 * behind nothing.
 */
export function createSidebarClickHandler(
  docActions: DocumentActions,
  ioGetter: () => Promise<PlatformIO>,
): (absPath: string, rootPath: string) => void {
  return (absPath, rootPath) => {
    if (!isPathInsideRoot(absPath, rootPath)) {
      console.warn('[sidebar] click rejected — target outside listing root', {
        target: absPath,
        root: rootPath,
      });
      return;
    }

    if (isMarkdownPath(absPath)) {
      // `rootPath` is passed on rather than dropped here (#178). The
      // panel keeps it only when the new document has no adjacent
      // structure of its own; one that does still moves the panel into
      // it, which is a capability rather than an accident. The check
      // above is what makes keeping it safe to state: a click that got
      // this far is inside `rootPath`, so the root that is kept always
      // contains the document that was opened — including the case of a
      // file clicked in a subfolder of the root.
      void docActions.openFilePath(absPath, rootPath).catch((e) => {
        console.error('[sidebar] openFilePath failed:', e);
      });
      return;
    }

    void (async () => {
      try {
        const io = await ioGetter();
        await io.openWithSystem(absPath);
        showToast('Opening with system viewer…', 'info');
      } catch (e) {
        // A path the shell scope refuses, a file gone since the listing, or
        // no application for the extension: the person is told (#448).
        reportSystemOpenFailure(basename(absPath), e);
      }
    })();
  };
}
