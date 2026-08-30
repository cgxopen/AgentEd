import { describe, expect, it } from 'vitest';
import { isTauri } from '../platform/detect';
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

/**
 * The kept root (#178), at the layer that decides what the panel shows.
 *
 * `state.sidebarRootFromClick` is set by `loadBundleFromPath` and is
 * `null` for every route into a document except a sidebar click. These
 * assert what `refreshSidebar` does with each value; the route that
 * produces it is asserted in `sidebar-flow.test.ts`, and the handler
 * that supplies it in `sidebar-click.test.ts`.
 */
describe('the root a sidebar click asked to keep (#178)', () => {
  const tree: Record<string, FileEntry[]> = {
    '/proj': [
      { name: 'one.md', path: '/proj/one.md', isDirectory: false },
      { name: 'two.md', path: '/proj/two.md', isDirectory: false },
    ],
    '/proj/two': [{ name: 'note.md', path: '/proj/two/note.md', isDirectory: false }],
  };

  function capture(): { sidebar: Sidebar; shown: () => string | null } {
    let root: string | null = null;
    return {
      sidebar: {
        showTree: (_nodes: TreeNode[], _rootName: string, rootPath: string) => {
          root = rootPath;
        },
        hide: () => {
          root = null;
        },
        isVisible: () => root !== null,
        toggle: () => {},
        setOnFileClick: () => {},
      },
      shown: () => root,
    };
  }

  it('with no adjacent structure of its own, the panel keeps the root', async () => {
    const state = new AppState();
    state.filePath = '/proj/one.md';
    state.sidebarRootFromClick = '/proj';
    const { sidebar, shown } = capture();

    await refreshSidebar(state, sidebar, mockIO({ existing: ['/proj'], entries: tree }));

    expect(shown()).toBe('/proj');
  });

  it('with adjacent structure of its own, the panel still descends into it', async () => {
    // The half a fix that made everything sticky would break. `two.md`
    // carries `two/`, so the document's own structure wins over the kept
    // root exactly as it did before this change.
    const state = new AppState();
    state.filePath = '/proj/two.md';
    state.sidebarRootFromClick = '/proj';
    const { sidebar, shown } = capture();

    await refreshSidebar(
      state,
      sidebar,
      mockIO({ existing: ['/proj', '/proj/two'], entries: tree }),
    );

    expect(shown()).toBe('/proj/two');
  });

  it('with nothing kept, a document with no structure still hides the panel', async () => {
    // The floor: `null` is every route that is not a sidebar click, and
    // it is the behaviour R-C6 always had.
    const state = new AppState();
    state.filePath = '/proj/one.md';
    state.sidebarRootFromClick = null;
    const { sidebar, shown } = capture();

    await refreshSidebar(state, sidebar, mockIO({ existing: ['/proj'], entries: tree }));

    expect(shown()).toBeNull();
  });

  it('resetDocument clears it, so New and Close cannot leak a folder forward', async () => {
    const state = new AppState();
    state.filePath = '/proj/one.md';
    state.sidebarRootFromClick = '/proj';

    state.resetDocument();

    expect(state.sidebarRootFromClick).toBeNull();
  });
});

/**
 * #146 — the platform fact reaches the renderer, and is not read there.
 *
 * This layer already asks the question in `file-association.ts` and
 * `image-loader.ts`; `src/ui` asks it nowhere and does not start here.
 * What the renderer does with each answer is asserted in
 * `src/ui/sidebar.test.ts`, both answers in one file, which is what
 * passing a value rather than reading a module-load constant buys.
 *
 * The desktop answer is asserted in `sidebar-platform.test.ts`, which
 * needs its own file because `vi.mock` of `platform/detect` is per file.
 */
describe('the sidebar is told whether this build can open a non-markdown file (#146)', () => {
  it('passes it as the fourth argument, from the one place that knows', async () => {
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

    await refreshSidebar(state, sidebar, mockIO({ existing: ['/proj/notes'] }));

    expect(passed).toBe(isTauri);
    // And under this harness that value is the web answer, which is the
    // platform the change is about. `happy-dom` has no
    // `__TAURI_INTERNALS__`, so nothing here is a desktop build.
    expect(passed).toBe(false);
  });
});
