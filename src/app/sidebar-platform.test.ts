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
    remove: async () => {},
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
      hide: () => {},
      isVisible: () => true,
      toggle: () => {},
      setOnFileClick: () => {},
    };

    await refreshSidebar(state, sidebar, mockIO(['/proj/notes']));

    expect(passed).toBe(true);
  });
});
