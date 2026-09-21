/**
 * End-to-end integration scenario for the sidebar flow (R-C6).
 * Composes shouldShowSidebar + walkRecursive (via refreshSidebar) + the
 * click handler against a stubbed PlatformIO that simulates a document
 * with an adjacent `assets/` folder three levels deep:
 *
 *   /proj/
 *   ├── doc.md          ← currently open
 *   └── assets/         ← sidebar root, the only trigger since #402
 *       ├── images/
 *       │   └── image.png
 *       ├── references/
 *       │   └── notes.md
 *       └── scripts/
 *           └── helper.py
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { Sidebar, TreeNode } from '../ui/sidebar';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { createSidebarClickHandler } from './sidebar-click';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

function buildIO(): PlatformIO {
  const tree: Record<string, FileEntry[]> = {
    '/proj/assets': [
      { name: 'images', path: '/proj/assets/images', isDirectory: true },
      { name: 'references', path: '/proj/assets/references', isDirectory: true },
      { name: 'scripts', path: '/proj/assets/scripts', isDirectory: true },
    ],
    '/proj/assets/images': [
      { name: 'image.png', path: '/proj/assets/images/image.png', isDirectory: false },
    ],
    '/proj/assets/references': [
      { name: 'notes.md', path: '/proj/assets/references/notes.md', isDirectory: false },
    ],
    '/proj/assets/scripts': [
      { name: 'helper.py', path: '/proj/assets/scripts/helper.py', isDirectory: false },
    ],
  };
  const existing = new Set(['/proj/assets']);
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
    listDir: async (p: string) => tree[p] ?? [],
    mkdir: async () => {},
    openWithSystem: vi.fn(async () => {}),
  };
}

function captureSidebar(): { sidebar: Sidebar; lastShow: () => SidebarShowCall | null } {
  let lastShow: SidebarShowCall | null = null;
  const sidebar: Sidebar = {
    showTree: (nodes, rootName, rootPath) => {
      lastShow = { nodes, rootName, rootPath };
    },
    showNothingRelated: () => {},
    showAccessOffer: () => {},
    hide: () => {
      lastShow = null;
    },
    isVisible: () => lastShow !== null,
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
  return { sidebar, lastShow: () => lastShow };
}

interface SidebarShowCall {
  nodes: TreeNode[];
  rootName: string;
  rootPath: string;
}

function makeDocActions(): DocumentActions {
  return {
    handleNew: vi.fn(async () => {}),
    handleNewFromTemplate: vi.fn(async () => {}),
    handleOpen: vi.fn(async () => {}),
    handleSave: vi.fn(async () => {}),
    handleSaveAs: vi.fn(async () => {}),
    handleClose: vi.fn(async () => {}),
    openFilePath: vi.fn(async () => {}),
    openRecentFile: vi.fn(async () => {}),
    requestSaveAs: vi.fn(async () => null),
    confirmWindowClose: vi.fn(async () => true),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Sidebar integration — adjacent folder, 3 levels', () => {
  it('lists images/, references/, scripts/ under the assets root', async () => {
    const state = new AppState();
    state.filePath = '/proj/doc.md';
    const io = buildIO();
    const { sidebar, lastShow } = captureSidebar();

    await refreshSidebar(state, sidebar, io);

    const call = lastShow();
    expect(call).not.toBeNull();
    expect(call!.rootPath).toBe('/proj/assets');

    const topLevel = call!.nodes.map((n) => n.name).sort();
    expect(topLevel).toEqual(['images', 'references', 'scripts']);

    const imagesNode = call!.nodes.find((n) => n.name === 'images');
    expect(imagesNode?.children.map((c) => c.name)).toEqual(['image.png']);

    const referencesNode = call!.nodes.find((n) => n.name === 'references');
    expect(referencesNode?.children.map((c) => c.name)).toEqual(['notes.md']);

    const scriptsNode = call!.nodes.find((n) => n.name === 'scripts');
    expect(scriptsNode?.children.map((c) => c.name)).toEqual(['helper.py']);
  });

  it('routes notes.md (nested .md) through openFilePath without touching state', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/references/notes.md', '/proj/doc');
    await flush();
    expect(docActions.openFilePath).toHaveBeenCalledWith(
      '/proj/doc/references/notes.md',
      '/proj/doc',
    );
    expect(io.openWithSystem).not.toHaveBeenCalled();
  });

  it('routes helper.py through openWithSystem', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/scripts/helper.py', '/proj/doc');
    await flush();
    expect(io.openWithSystem).toHaveBeenCalledWith('/proj/doc/scripts/helper.py');
    expect(docActions.openFilePath).not.toHaveBeenCalled();
  });

  it('routes image.png through openWithSystem', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/assets/image.png', '/proj/doc');
    await flush();
    expect(io.openWithSystem).toHaveBeenCalledWith('/proj/doc/assets/image.png');
  });

  it('refuses a crafted ".." that would escape the listing root', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/../doc.md', '/proj/doc');
    await flush();
    expect(docActions.openFilePath).not.toHaveBeenCalled();
    expect(io.openWithSystem).not.toHaveBeenCalled();
  });
});

/**
 * #178, driven end to end: the click handler, the real `openFilePath`
 * and the real `refreshSidebar` over one in-memory disk, shaped like the
 * folder the owner tests by hand.
 *
 *   /book/proiect.md         ← opened first; roots the panel at /book/assets
 *   /book/assets/
 *     cap1.md                ← no assets/ of its own
 *     cap3.md
 *     deep/cap2.md           ← has deep/assets/ beside it
 *     deep/assets/note.md
 *     sub/chapter.md         ← the subfolder case, no assets/ of its own
 *
 * Reshaped on #402, where the folder named after the document stopped
 * being a trigger. The two halves are the same two halves; the structure
 * a clicked document can carry is now an `assets/` folder, so the
 * descending half needs one a level down.
 *
 * Both halves of the decision are here, and they fail for opposite
 * reasons: the keeping half fails if the root is dropped, the descending
 * half fails if everything is made sticky. Neither implies the other,
 * and a fix that satisfies only the first passes half a decision.
 */
const flowDisk = new Map<string, string>([
  ['/book/proiect.md', '# Proiect\n'],
  ['/book/assets/cap1.md', '# Cap 1\n'],
  ['/book/assets/cap3.md', '# Cap 3\n'],
  ['/book/assets/deep/cap2.md', '# Cap 2\n'],
  ['/book/assets/deep/assets/note.md', '# Note\n'],
  ['/book/assets/sub/chapter.md', '# Chapter\n'],
]);
const flowDirs = new Set([
  '/book/assets',
  '/book/assets/deep',
  '/book/assets/deep/assets',
  '/book/assets/sub',
]);
const flowListing: Record<string, FileEntry[]> = {
  '/book/assets': [
    { name: 'cap1.md', path: '/book/assets/cap1.md', isDirectory: false },
    { name: 'cap3.md', path: '/book/assets/cap3.md', isDirectory: false },
    { name: 'deep', path: '/book/assets/deep', isDirectory: true },
    { name: 'sub', path: '/book/assets/sub', isDirectory: true },
  ],
  '/book/assets/deep': [
    { name: 'cap2.md', path: '/book/assets/deep/cap2.md', isDirectory: false },
    { name: 'assets', path: '/book/assets/deep/assets', isDirectory: true },
  ],
  '/book/assets/deep/assets': [
    { name: 'note.md', path: '/book/assets/deep/assets/note.md', isDirectory: false },
  ],
  '/book/assets/sub': [
    { name: 'chapter.md', path: '/book/assets/sub/chapter.md', isDirectory: false },
  ],
};

const flowIO: PlatformIO = {
  supportsMultiFile: true,
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (path: string) => {
    const text = flowDisk.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  saveFile: async () => {},
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    const text = flowDisk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: async (path: string) =>
    flowDirs.has(path) || flowDisk.has(path) ? 'present' : 'absent',
  listDir: async (path: string) => flowListing[path] ?? [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => flowIO) }));

describe('#178 — a document opened from the tree, and the tree afterwards', () => {
  let state: AppState;
  let panel: SidebarShowCall | null;
  let actions: DocumentActions;
  let markdown: string;

  /** What the panel is showing, as the user would describe it. */
  function panelRoot(): string | null {
    return panel === null ? null : panel.rootPath;
  }

  function panelNames(): string[] {
    return panel === null ? [] : panel.nodes.map((n) => n.name);
  }

  function click(absPath: string): void {
    const root = panelRoot();
    expect(root).not.toBeNull();
    createSidebarClickHandler(actions, async () => flowIO)(absPath, root!);
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    state = new AppState();
    panel = null;
    markdown = '';
    const sidebar: Sidebar = {
      showTree: (nodes, rootName, rootPath) => {
        panel = { nodes, rootName, rootPath };
      },
      showNothingRelated: () => {},
      showAccessOffer: () => {},
      hide: () => {
        panel = null;
      },
      isVisible: () => panel !== null,
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
    const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };
    actions = createDocumentActions({
      state,
      reporter,
      getMarkdown: () => markdown,
      setMarkdown: (md: string) => {
        markdown = md;
      },
      refreshSidebar: async () => {
        await refreshSidebar(state, sidebar, flowIO);
      },
      setFilename: () => {},
      updateCloseEnabled: () => {},
      sidebar,
      statusbar: { refresh: () => {} },
      frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
    } as unknown as AppContext);
  });

  it('the fixture is a real document rather than an empty file (#166)', () => {
    for (const [path, text] of flowDisk) {
      expect(text.length, path).toBeGreaterThan(0);
    }
  });

  it('half (a) — a clicked file with no structure of its own leaves the tree standing', async () => {
    await actions.openFilePath('/book/proiect.md');
    expect(panelRoot()).toBe('/book/assets');

    click('/book/assets/cap1.md');
    await settle();

    expect(state.filePath).toBe('/book/assets/cap1.md');
    expect(panelRoot()).toBe('/book/assets');
    expect(panelNames()).toContain('cap3.md');
  });

  it('the two clicks the issue is about — cap1.md and then cap3.md', async () => {
    await actions.openFilePath('/book/proiect.md');

    click('/book/assets/cap1.md');
    await settle();
    click('/book/assets/cap3.md');
    await settle();

    expect(state.filePath).toBe('/book/assets/cap3.md');
    expect(panelRoot()).toBe('/book/assets');
  });

  it('half (b) — a clicked file WITH structure of its own still moves the panel into it', async () => {
    await actions.openFilePath('/book/proiect.md');

    click('/book/assets/deep/cap2.md');
    await settle();

    expect(state.filePath).toBe('/book/assets/deep/cap2.md');
    expect(panelRoot()).toBe('/book/assets/deep/assets');
    expect(panelNames()).toEqual(['note.md']);
  });

  it('a file clicked in a subfolder keeps the folder being browsed, not its own', async () => {
    // The click never left `/proiect` — `isPathInsideRoot` in the handler
    // is what makes that true of every click that gets this far.
    await actions.openFilePath('/book/proiect.md');

    click('/book/assets/sub/chapter.md');
    await settle();

    expect(state.filePath).toBe('/book/assets/sub/chapter.md');
    expect(panelRoot()).toBe('/book/assets');
  });

  it('the floor — the same file opened any other way still hides the panel', async () => {
    // File → Open, the file association and the context popover all call
    // `openFilePath` with a path and nothing else. Asserted from the
    // panel that a click had made sticky, so this is the value being
    // cleared rather than one that was never set.
    await actions.openFilePath('/book/proiect.md');
    click('/book/assets/cap1.md');
    await settle();
    expect(panelRoot()).toBe('/book/assets');

    await actions.openFilePath('/book/assets/cap1.md');

    expect(panelRoot()).toBeNull();
  });

  it('the floor — a save does not dissolve a tree that a click kept', async () => {
    await actions.openFilePath('/book/proiect.md');
    click('/book/assets/cap1.md');
    await settle();

    await actions.handleSave();

    expect(panelRoot()).toBe('/book/assets');
  });

  it('the floor — Close clears the kept root as well as the panel', async () => {
    await actions.openFilePath('/book/proiect.md');
    click('/book/assets/cap1.md');
    await settle();

    await actions.handleClose();

    expect(state.sidebarRootFromClick).toBeNull();
    expect(panelRoot()).toBeNull();
  });
});
