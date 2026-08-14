import { isPathInsideRoot } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { showToast } from '../ui/toast';
import type { DocumentActions } from './document-actions';

/**
 * Build the sidebar's file-click handler. Decision tree:
 *
 *   1. Validate the target is inside the listing root. Fail silently
 *      (console.warn for debugging, no user-facing message) — security
 *      events should not be surfaced or guess-able.
 *   2. Markdown file (`.md` / `.markdown`) → reuse the existing
 *      `openFilePath` flow, which routes through the unsaved-changes
 *      safety gate and re-runs profile detection on the new document.
 *   3. Anything else → open with the host OS via Tauri shell. The
 *      current document's editor state stays untouched in the
 *      background. Brief toast confirms the action.
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

    const lower = absPath.toLowerCase();
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
      void docActions.openFilePath(absPath).catch((e) => {
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
        console.error('[sidebar] openWithSystem failed:', e);
      }
    })();
  };
}
