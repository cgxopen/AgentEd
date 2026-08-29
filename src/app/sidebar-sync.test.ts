import { describe, expect, it } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import type { Sidebar, TreeNode } from '../ui/sidebar';
import { refreshSidebar, shouldShowSidebar } from './sidebar-sync';
import { AppState } from './state';

interface MockIOOptions {
  /** Paths whose `entryPresence` answers `present`. */
  existing?: ReadonlyArray<string>;
  /** Map from directory → entries returned by listDir. */
  entries?: Readonly<Record<string, FileEntry[]>>;
}

function mockIO(options: MockIOOptions = {}): PlatformIO {
  const existing = new Set(options.existing ?? []);
  return {
    supportsMultiFile: true,
    // Desktop-shaped: every path carries a directory (#46).
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
    listDir: async (p: string) => options.entries?.[p] ?? [],
    mkdir: async () => {},
    remove: async () => {},
    openWithSystem: async () => {},
  };
}

describe('shouldShowSidebar', () => {
  it('hides when filePath is null', async () => {
    const decision = await shouldShowSidebar(null, mockIO());
    expect(decision.show).toBe(false);
  });

  it('adjacent folder named after the file → root = that folder', async () => {
    const decision = await shouldShowSidebar(
      '/proj/notes.md',
      mockIO({ existing: ['/proj/notes'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/notes' });
  });

  it('adjacent assets/ → root = <dirname>/assets/', async () => {
    const decision = await shouldShowSidebar(
      '/proj/notes.md',
      mockIO({ existing: ['/proj/assets'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/assets' });
  });

  it('the named folder wins over assets/ when both exist', async () => {
    const decision = await shouldShowSidebar(
      '/proj/notes.md',
      mockIO({ existing: ['/proj/notes', '/proj/assets'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/notes' });
  });

  it('no adjacent structure → hidden', async () => {
    const decision = await shouldShowSidebar('/proj/notes.md', mockIO());
    expect(decision.show).toBe(false);
  });

  it('a file at the filesystem root with no adjacent structure → hidden', async () => {
    const decision = await shouldShowSidebar('/notes.md', mockIO({ existing: ['/'] }));
    expect(decision.show).toBe(false);
  });
});

/**
 * The depth bound on the walk, asserted rather than assumed (#174).
 *
 * `walkRecursive` is private, so this drives the real `refreshSidebar` and
 * records which directories it asked for. It is here because #174 made
 * `buildTree` linear and the acceptance criterion for that change is that the
 * bound which *does* exist is not disturbed by it: `MAX_LIST_DEPTH` bounds
 * the **depth** of the walk, and nothing in this repository bounds its
 * breadth — deliberately, and measured, see the pull request for #174.
 *
 * Nothing asserted this before. The file covered `shouldShowSidebar` alone.
 */
describe('the walk stops at MAX_LIST_DEPTH (#174)', () => {
  /** A tree with no bottom: every directory holds one directory. */
  function endlessIO(root: string, asked: string[]): PlatformIO {
    const io = mockIO({ existing: [root] });
    return {
      ...io,
      listDir: async (p: string): Promise<FileEntry[]> => {
        asked.push(p);
        return [{ name: 'down', path: `${p}/down`, isDirectory: true }];
      },
    };
  }

  const noopSidebar = (): Sidebar => ({
    showTree: (_nodes: TreeNode[]) => {},
    hide: () => {},
    isVisible: () => false,
    toggle: () => {},
    setOnFileClick: () => {},
  });

  it('lists seven levels and no eighth, however deep the tree goes', async () => {
    const asked: string[] = [];
    const state = new AppState();
    state.filePath = '/doc.md';

    await refreshSidebar(state, noopSidebar(), endlessIO('/doc', asked));

    // `walk` starts at depth 0 and returns at `depth > MAX_LIST_DEPTH`, so
    // the root and six levels below it are listed and the seventh is not.
    // Written as the paths rather than as a count, so a change to the bound
    // says which level it moved.
    expect(asked).toEqual([
      '/doc',
      '/doc/down',
      '/doc/down/down',
      '/doc/down/down/down',
      '/doc/down/down/down/down',
      '/doc/down/down/down/down/down',
      '/doc/down/down/down/down/down/down',
    ]);
  });

  it('records the entry at the bottom even though it does not list it', async () => {
    // The half that says the bound cuts the *walk* and not the tree: the
    // deepest directory is still an entry, it simply has no children.
    const asked: string[] = [];
    const state = new AppState();
    state.filePath = '/doc.md';
    let built: TreeNode[] = [];

    await refreshSidebar(
      state,
      {
        ...noopSidebar(),
        showTree: (nodes: TreeNode[]) => {
          built = nodes;
        },
      },
      endlessIO('/doc', asked),
    );

    let depth = 0;
    let cursor = built;
    while (cursor.length > 0) {
      depth++;
      cursor = cursor[0].children;
    }
    expect(depth).toBe(7);
  });
});
