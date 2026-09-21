/**
 * #354 — the desktop answer to an open by hand when the folder beside the
 * document could not be read.
 *
 * Its own file because `isTauri` is a module constant and `vi.mock` is per
 * file; the browser rows are in `sidebar-open-by-hand.test.ts`. On the desktop
 * `entryPresence` answers `unknown` when the file system refused the lookup,
 * and `NO_RELATED_ITEMS` would be false there, since nothing was read.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlatformIO } from '../platform/types';
import { FOLDER_UNREADABLE, NO_RELATED_ITEMS, setupSidebar } from '../ui/sidebar';
import { openSidebarByHand, refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

vi.mock('../platform/detect', () => ({ isTauri: true }));

/** A folder the file system refuses to answer about. */
function unreadable(): PlatformIO {
  return {
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    readSnapshot: async () => ({ kind: 'absent' as const }),
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async () => 'unknown',
    listDir: async () => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

function mount() {
  document.body.innerHTML =
    '<aside id="sidebar" class="hidden"><div id="sidebar-tree"></div></aside>';
  const sidebar = setupSidebar();
  const state = new AppState();
  state.filePath = 'C:\\proj\\notes.md';
  const reads: Array<Promise<void>> = [];
  sidebar.setOnOpenByHand((ticket) => {
    reads.push(openSidebarByHand(state, sidebar, unreadable(), ticket));
  });
  return {
    sidebar,
    state,
    reads,
    panel: document.getElementById('sidebar') as HTMLElement,
    tree: document.getElementById('sidebar-tree') as HTMLElement,
  };
}

describe('a folder the desktop could not read (#354)', () => {
  it('opened by hand, says so rather than that nothing is there', async () => {
    const view = mount();
    view.sidebar.toggle();
    await Promise.all(view.reads);

    expect(view.tree.textContent).toBe(FOLDER_UNREADABLE);
    expect(view.tree.textContent).not.toBe(NO_RELATED_ITEMS);
  });

  it('reached by a document switch, stays silent as it always did', async () => {
    const view = mount();
    await refreshSidebar(view.state, view.sidebar, unreadable());

    expect(view.panel.classList.contains('hidden')).toBe(true);
    expect(view.tree.textContent).toBe('');
  });
});
