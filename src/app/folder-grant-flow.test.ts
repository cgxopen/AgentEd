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
  sidebar: Sidebar,
): () => Promise<void> {
  return async () => {
    if (!(await requestFolderAccess())) return;
    await refresh();
    if (!sidebar.isVisible()) sidebar.showNothingRelated();
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
      granted.current ? (p === '/proj/assets' ? 'present' : 'absent') : 'unknown',
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

function harness() {
  const granted = { current: false };
  const io = ioWith(granted);
  const state = new AppState();
  state.filePath = '/proj/notes.md';
  const seen: string[] = [];
  // Visibility is tracked rather than stubbed: the rule under test is
  // "if the refresh left the panel hidden, say so", so a sidebar that
  // always answers `true` would assert nothing.
  let visible = false;
  const sidebar: Sidebar = {
    showTree: (_n: TreeNode[], _r: string, rootPath: string) => {
      seen.push(`tree:${rootPath}`);
      visible = true;
    },
    showAccessOffer: () => {
      seen.push('offer');
      visible = true;
    },
    showNothingRelated: () => {
      seen.push('nothing-related');
      visible = true;
    },
    hide: () => {
      seen.push('hidden');
      visible = false;
    },
    isVisible: () => visible,
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
  return {
    granted,
    seen,
    sidebar,
    refresh: () => refreshSidebar(state, sidebar, io),
  };
}

describe('#184 — accepting the offer', () => {
  it('a grant redraws the panel in the same gesture, with no reload', async () => {
    const { granted, seen, sidebar, refresh } = harness();
    await refresh();
    expect(seen).toEqual(['offer']);

    const request = vi.fn(async () => {
      granted.current = true;
      return true;
    });
    await acceptOffer(request, refresh, sidebar)();

    expect(seen).toEqual(['offer', 'tree:/proj/assets']);
  });

  it('a cancelled picker changes nothing and says nothing', async () => {
    const { seen, sidebar, refresh } = harness();
    await refresh();
    expect(seen).toEqual(['offer']);

    const request = vi.fn(async () => false);
    await acceptOffer(request, refresh, sidebar)();

    // Still exactly one call: the panel was not redrawn, so the line the
    // user is looking at is the line that was already there (#61).
    expect(seen).toEqual(['offer']);
  });
});

describe('#184 — a folder that was asked for and holds nothing', () => {
  it('says so, because the user asked and an absence is not an answer', async () => {
    // The granted folder answers, and there is nothing beside the
    // document. True, complete — and put to the application by the user
    // one gesture earlier, so #130 says it gets an answer.
    const granted = { current: false };
    const io: PlatformIO = {
      ...ioWith(granted),
      entryPresence: async () => (granted.current ? 'absent' : 'unknown'),
    };
    const state = new AppState();
    state.filePath = '/proj/notes.md';
    const seen: string[] = [];
    let visible = false;
    const sidebar: Sidebar = {
      showTree: (_n: TreeNode[], _r: string, rootPath: string) => {
        seen.push(`tree:${rootPath}`);
        visible = true;
      },
      showAccessOffer: () => {
        seen.push('offer');
        visible = true;
      },
      showNothingRelated: () => {
        seen.push('nothing-related');
        visible = true;
      },
      hide: () => {
        seen.push('hidden');
        visible = false;
      },
      isVisible: () => visible,
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
    const refresh = () => refreshSidebar(state, sidebar, io);

    await refresh();
    expect(seen).toEqual(['offer']);

    await acceptOffer(
      async () => {
        granted.current = true;
        return true;
      },
      refresh,
      sidebar,
    )();

    // Hidden by the refresh, then answered — and the panel stays open on
    // the answer rather than closing on the user's own question.
    expect(seen).toEqual(['offer', 'hidden', 'nothing-related']);
    expect(sidebar.isVisible()).toBe(true);
  });

  it('and nobody else is told, which is the whole of the distinction', async () => {
    // The same state reached without anyone asking: a document whose
    // granted folder simply holds nothing adjacent. `refreshSidebar`
    // hides and says nothing, and cannot say anything — the sentence
    // lives in the handler that ran the picker, not in the decision.
    const granted = { current: true };
    const io: PlatformIO = { ...ioWith(granted), entryPresence: async () => 'absent' };
    const state = new AppState();
    state.filePath = '/proj/notes.md';
    const seen: string[] = [];
    const sidebar: Sidebar = {
      showTree: () => seen.push('tree'),
      showAccessOffer: () => seen.push('offer'),
      showNothingRelated: () => seen.push('nothing-related'),
      hide: () => seen.push('hidden'),
      isVisible: () => false,
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

    await refreshSidebar(state, sidebar, io);

    expect(seen).toEqual(['hidden']);
    expect(seen).not.toContain('nothing-related');
  });
});
