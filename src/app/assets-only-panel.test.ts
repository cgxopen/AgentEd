/**
 * #402 — the panel appears for an `assets/` folder and for nothing else.
 *
 * Two halves that must fall for opposite reasons. **A** is the rule that
 * left: a folder named after the document no longer opens the panel, on a
 * switch or by hand. **B** is the rule that stayed: an `assets/` folder
 * still does, by both routes, and the #380 grey still reaches the panel.
 *
 * Driven through `refreshSidebar` and `openSidebarByHand`, the two routes
 * R-C6 names, against a recording `Sidebar` — so what is asserted is what
 * the panel was told to show rather than what a decision function
 * returned. `sidebar-sync.test.ts` holds the decision itself.
 */
import { describe, expect, it } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import type { Sidebar, TreeNode } from '../ui/sidebar';
import { openSidebarByHand, refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

const DOC = '/proj/chapter.md';

/** `present` for each path given, `absent` for everything else. */
function io(present: string[], listing: Record<string, FileEntry[]> = {}): PlatformIO {
  const there = new Set(present);
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
    entryPresence: async (p: string) => (there.has(p) ? 'present' : 'absent'),
    listDir: async (p: string) => listing[p] ?? [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

interface Seen {
  sidebar: Sidebar;
  /** What the panel was last told, as the user would describe it. */
  showing: () => string;
  /** The names in the tree the panel was last given. */
  names: () => string[];
}

function recorder(): Seen {
  let last = 'hidden';
  let nodes: TreeNode[] = [];
  const sidebar: Sidebar = {
    showTree: (n: TreeNode[], _rootName: string, rootPath: string) => {
      last = `tree:${rootPath}`;
      nodes = n;
    },
    showNothingRelated: () => {
      last = 'No related files or folders';
    },
    showAccessOffer: () => {
      last = 'offer';
    },
    showUnreadable: () => {
      last = 'unreadable';
    },
    hide: () => {
      last = 'hidden';
    },
    isVisible: () => last !== 'hidden',
    toggle: () => {},
    setOnFileClick: () => {},
    onVisibleChange: () => {},
    setOnRequestAccess: () => {},
    isCurrent: () => true,
    beginSwitch: () => 0,
    isLatest: () => true,
    isClosedByHand: () => false,
    forgetClosedByHand: () => {},
    markUnused: () => {},
    setOnOpenByHand: () => {},
  };
  return { sidebar, showing: () => last, names: () => nodes.map((n) => n.name) };
}

function stateAt(path: string): AppState {
  const state = new AppState();
  state.filePath = path;
  return state;
}

describe('A — a folder named after the document is not a trigger (#402)', () => {
  it('stays hidden on a document switch', async () => {
    const seen = recorder();
    await refreshSidebar(stateAt(DOC), seen.sidebar, io(['/proj/chapter']));
    expect(seen.showing()).toBe('hidden');
  });

  it('says No related files or folders when the panel is opened by hand', async () => {
    const seen = recorder();
    await openSidebarByHand(stateAt(DOC), seen.sidebar, io(['/proj/chapter']), 0);
    expect(seen.showing()).toBe('No related files or folders');
  });

  it('and the folder is not listed by either route', async () => {
    // The half that a test asserting only `hidden` would miss: the folder
    // is there and full, and nothing reaches it.
    const listing = {
      '/proj/chapter': [{ name: 'one.md', path: '/proj/chapter/one.md', isDirectory: false }],
    };
    const onSwitch = recorder();
    await refreshSidebar(stateAt(DOC), onSwitch.sidebar, io(['/proj/chapter'], listing));
    const byHand = recorder();
    await openSidebarByHand(stateAt(DOC), byHand.sidebar, io(['/proj/chapter'], listing), 0);
    expect([onSwitch.showing(), byHand.showing()]).toEqual([
      'hidden',
      'No related files or folders',
    ]);
  });
});

describe('B — an assets/ folder still is one (#402)', () => {
  const listing = {
    '/proj/assets': [{ name: 'diagram.png', path: '/proj/assets/diagram.png', isDirectory: false }],
  };

  it('shows the tree on a document switch', async () => {
    const seen = recorder();
    await refreshSidebar(stateAt(DOC), seen.sidebar, io(['/proj/assets'], listing));
    expect(seen.showing()).toBe('tree:/proj/assets');
  });

  it('shows the same tree when the panel is opened by hand', async () => {
    const seen = recorder();
    await openSidebarByHand(stateAt(DOC), seen.sidebar, io(['/proj/assets'], listing), 0);
    expect(seen.showing()).toBe('tree:/proj/assets');
  });

  it('lists what the assets folder holds, by both routes', async () => {
    // The half a row asserting only the root would miss: the tree is read
    // and drawn, not merely rooted.
    const onSwitch = recorder();
    await refreshSidebar(stateAt(DOC), onSwitch.sidebar, io(['/proj/assets'], listing));
    const byHand = recorder();
    await openSidebarByHand(stateAt(DOC), byHand.sidebar, io(['/proj/assets'], listing), 0);
    expect([onSwitch.names(), byHand.names()]).toEqual([['diagram.png'], ['diagram.png']]);
  });

  // **The #380 grey is not asserted here, and it is not out of reach
  // either.** The predicate `main.ts` hands to `markUnused` is built from
  // the document and its path rather than from the panel root, so nothing
  // about *which* files are grey depends on this change. What does depend
  // on it is whether there is a tree to grey at all: measured, breaking
  // the `assets/` probe turns **15 rows of `unused-assets.test.ts`** red.
  // So the grey is held there, on a larger fixture than this file has, and
  // repeating it here would be a second copy of the same guard.
});

/**
 * Not a third witness, and measured rather than assumed: the row below
 * turns red under **both** reversals — the sibling probe put back, and the
 * `assets/` probe broken. It is contained in each of them, so it proves
 * nothing they do not, and it is kept because it records the before and
 * after of the one arrangement where the two rules used to disagree.
 */
describe('both folders beside the document (#402)', () => {
  it('roots at assets/, where before this change it rooted at the named folder', async () => {
    const seen = recorder();
    await refreshSidebar(
      stateAt(DOC),
      seen.sidebar,
      io(['/proj/chapter', '/proj/assets'], {
        '/proj/assets': [{ name: 'a.png', path: '/proj/assets/a.png', isDirectory: false }],
      }),
    );
    expect(seen.showing()).toBe('tree:/proj/assets');
  });
});
