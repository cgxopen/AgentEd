/**
 * #184 — the grant and the panel are one gesture.
 *
 * The wiring in `main.ts` is three lines and this drives the shape of
 * them rather than the file: accept the offer, and if a folder came back
 * the panel is redrawn **without a reload**; if the picker was
 * cancelled, nothing is redrawn and nothing is said.
 *
 * That second half is the one a fix gets wrong quietly. A refresh on
 * every click is invisible when the grant succeeded and wrong only when
 * it did not, which is the branch nobody exercises by hand.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import type { Sidebar, TreeNode } from '../ui/sidebar';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

/**
 * The handler `main.ts` installs, written once here so the test drives
 * the rule rather than a copy of the call site.
 */
function acceptOffer(
  requestFolderAccess: () => Promise<boolean>,
  refresh: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    if (await requestFolderAccess()) await refresh();
  };
}

function ioWith(granted: { current: boolean }): PlatformIO {
  return {
    supportsMultiFile: true,
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
    // Before a grant nothing was looked at; after one the folder answers.
    entryPresence: async (p: string) =>
      granted.current ? (p === '/proj/notes' ? 'present' : 'absent') : 'unknown',
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    remove: async () => {},
    openWithSystem: async () => {},
  };
}

function harness() {
  const granted = { current: false };
  const io = ioWith(granted);
  const state = new AppState();
  state.filePath = '/proj/notes.md';
  const seen: string[] = [];
  const sidebar: Sidebar = {
    showTree: (_n: TreeNode[], _r: string, rootPath: string) => {
      seen.push(`tree:${rootPath}`);
    },
    showAccessOffer: () => {
      seen.push('offer');
    },
    hide: () => {
      seen.push('hidden');
    },
    isVisible: () => true,
    toggle: () => {},
    setOnFileClick: () => {},
    setOnRequestAccess: () => {},
  };
  return {
    granted,
    seen,
    refresh: () => refreshSidebar(state, sidebar, io),
  };
}

describe('#184 — accepting the offer', () => {
  it('a grant redraws the panel in the same gesture, with no reload', async () => {
    const { granted, seen, refresh } = harness();
    await refresh();
    expect(seen).toEqual(['offer']);

    const request = vi.fn(async () => {
      granted.current = true;
      return true;
    });
    await acceptOffer(request, refresh)();

    expect(seen).toEqual(['offer', 'tree:/proj/notes']);
  });

  it('a cancelled picker changes nothing and says nothing', async () => {
    const { seen, refresh } = harness();
    await refresh();
    expect(seen).toEqual(['offer']);

    const request = vi.fn(async () => false);
    await acceptOffer(request, refresh)();

    // Still exactly one call: the panel was not redrawn, so the line the
    // user is looking at is the line that was already there (#61).
    expect(seen).toEqual(['offer']);
  });
});
