/**
 * #146 — the desktop answer of the fact `refreshSidebar` passes down.
 *
 * Its own file, and only because of a constraint rather than a
 * preference: `isTauri` is a `const` evaluated when `platform/detect` is
 * loaded, so the only way to drive the other answer is `vi.mock`, which
 * is per file. Everything else about the two platforms is asserted side
 * by side in `src/ui/sidebar.test.ts`.
 *
 * Without this, "always false" would be indistinguishable from the real
 * value everywhere in the suite, since the harness is web-shaped.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import type { Sidebar, TreeNode } from '../ui/sidebar';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

vi.mock('../platform/detect', () => ({ isTauri: true }));

function mockIO(present: ReadonlyArray<string>): PlatformIO {
  const existing = new Set(present);
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
    entryPresence: async (p: string) => (existing.has(p) ? 'present' : 'absent'),
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

describe('on a desktop build (#146)', () => {
  it('the sidebar is told that a non-markdown file can be opened', async () => {
    const state = new AppState();
    state.filePath = '/proj/notes.md';
    let passed: unknown = 'nothing was passed';
    const sidebar: Sidebar = {
      showTree: (_n: TreeNode[], _r: string, _p: string, opensNonMarkdown: boolean) => {
        passed = opensNonMarkdown;
      },
      showNothingRelated: () => {},
      showAccessOffer: () => {},
      hide: () => {},
      isVisible: () => true,
      toggle: () => {},
      setOnFileClick: () => {},
      onVisibleChange: () => {},
      setOnRequestAccess: () => {},
      showUnreadable: () => {},
      isCurrent: () => true,
      beginSwitch: () => 0,
      isLatest: () => true,
      isClosedByHand: () => false,
      forgetClosedByHand: () => {},
      markUnused: () => {},
      setOnOpenByHand: () => {},
    };

    await refreshSidebar(state, sidebar, mockIO(['/proj/assets']));

    expect(passed).toBe(true);
  });
});

/**
 * The offer is never drawn on the desktop (#184).
 *
 * **`unknown` is the same value on both platforms and not the same
 * state.** `TauriIO.entryPresence` answers it when `fsExists` throws —
 * an unreadable path, #58's family — where `WebIO` answers it when no
 * folder was ever granted. Only the second has a grant to offer.
 *
 * Without this, a folder the desktop cannot read draws a line saying
 * AgentEd has not been given access to a folder, on a build with no such
 * notion, over a click `requestFolderAccess` answers `false` to. It was
 * reachable in the first draft of this change: the reversal that covered
 * it tested only that the capability answers `false`, not that the line
 * cannot be drawn.
 */
describe('an unreadable path on the desktop (#184)', () => {
  it('hides the panel and offers nothing', async () => {
    const state = new AppState();
    state.filePath = '/proj/notes.md';
    const seen: string[] = [];
    const sidebar: Sidebar = {
      showTree: (_n: TreeNode[], _r: string, rootPath: string) => {
        seen.push(`tree:${rootPath}`);
      },
      showNothingRelated: () => {},
      showAccessOffer: () => {
        seen.push('offer');
      },
      hide: () => {
        seen.push('hidden');
      },
      isVisible: () => true,
      toggle: () => {},
      setOnFileClick: () => {},
      onVisibleChange: () => {},
      setOnRequestAccess: () => {},
      showUnreadable: () => {},
      isCurrent: () => true,
      beginSwitch: () => 0,
      isLatest: () => true,
      isClosedByHand: () => false,
      forgetClosedByHand: () => {},
      markUnused: () => {},
      setOnOpenByHand: () => {},
    };

    const unreadable: PlatformIO = { ...mockIO([]), entryPresence: async () => 'unknown' };
    await refreshSidebar(state, sidebar, unreadable);

    expect(seen).toEqual(['hidden']);
    expect(seen).not.toContain('offer');
  });
});
