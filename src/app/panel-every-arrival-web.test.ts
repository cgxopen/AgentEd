/**
 * #790, row 10 - the web build: an arrival never opens the files panel on its
 * own, whatever is stored (owner decision of 2026-11-24, point 4), and a panel
 * opened by hand is hidden by a plain document arriving, as before.
 *
 * Its own file because `isTauri` is a module constant and `vi.mock` is per
 * file; the desktop rows are in `panel-every-arrival.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformIO } from '../platform/types';
import { loadSidebarGesture, saveSidebarGesture } from '../preferences';
import { setupSidebar } from '../ui/sidebar';
import { openSidebarByHand, refreshSidebar, windowGesture } from './sidebar-sync';
import { AppState } from './state';

vi.mock('../platform/detect', () => ({ isTauri: false }));

/** A web-shaped folder with a grant: no markdown tree, nothing beside the document. */
const io = {
  canWriteCompanions: async () => true,
  entryPresence: async () => 'absent',
  listDir: async () => [],
} as unknown as PlatformIO;

afterEach(() => localStorage.clear());

describe('the web build at an arrival (#790)', () => {
  it('row 10: never opened on its own, whatever is stored; opened by hand, hidden by a plain arrival as before', async () => {
    document.body.innerHTML =
      '<aside id="sidebar" class="hidden"><div id="sidebar-tree"></div></aside>';
    saveSidebarGesture('open');
    const sidebar = setupSidebar();
    const kept = windowGesture(loadSidebarGesture, saveSidebarGesture, sidebar);
    const askedToOpen = vi.spyOn(sidebar, 'openAsIfPressed');
    const state = new AppState();
    state.filePath = 'notes/plan.md';

    await refreshSidebar(state, sidebar, io, 'document-arrived', kept);
    expect(sidebar.isVisible()).toBe(false);
    expect(askedToOpen).not.toHaveBeenCalled();

    const reads: Array<Promise<void>> = [];
    sidebar.setOnOpenByHand((ticket) => {
      reads.push(openSidebarByHand(state, sidebar, io, ticket));
    });
    sidebar.toggle();
    await Promise.all(reads);
    expect(sidebar.isVisible()).toBe(true);
    state.filePath = 'notes/other.md';
    await refreshSidebar(state, sidebar, io, 'document-arrived', kept);
    expect(sidebar.isVisible()).toBe(false);
  });
});
