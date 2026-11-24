/**
 * #788, row 6 - the web build never opens the files panel on its own, whatever
 * is stored (owner decision of 2026-11-24, point 4).
 *
 * Its own file because `isTauri` is a module constant and `vi.mock` is per
 * file; the desktop rows are in `panel-at-start.test.ts`. The open at a start
 * is asked from the one door a start comes through, `setupFileAssociation`,
 * and the web build has no such door: a tab is handed no path by any process,
 * so the door installs nothing and the open is never asked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveSidebarGesture } from '../preferences';
import { setupSidebar } from '../ui/sidebar';
import type { ErrorReporter } from './error-reporter';
import { setupFileAssociation } from './file-association';
import { openPanelAtStart } from './panel-at-start';

vi.mock('../platform/detect', () => ({ isTauri: false }));

const listened = vi.fn();
vi.mock('../platform/file-open', () => ({
  listenForFileOpen: async (open: (path: string) => void) => listened(open),
}));

afterEach(() => localStorage.clear());

describe('the web build at a start (#788)', () => {
  it('row 6: never opened on its own, whatever is stored', async () => {
    document.body.innerHTML =
      '<aside id="sidebar" class="hidden"><div id="sidebar-tree"></div></aside>';
    saveSidebarGesture('open');
    const sidebar = setupSidebar();
    const askedToOpen = vi.spyOn(sidebar, 'openAsIfPressed');
    const open = vi.fn(async () => {});
    setupFileAssociation(
      openPanelAtStart({
        open,
        remembered: () => 'open',
        filePath: () => 'notes/plan.md',
        panel: sidebar,
      }),
      { dialog: vi.fn(async () => {}) } as unknown as ErrorReporter,
    );
    await Promise.resolve();

    expect(listened).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(askedToOpen).not.toHaveBeenCalled();
    expect(sidebar.isVisible()).toBe(false);
  });
});
