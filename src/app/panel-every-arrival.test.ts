/**
 * #790 - a files panel last opened by hand is open for every document that has
 * a file, however it arrives (owner decision of 2026-11-24), and the start of
 * #788, which is now one of those arrivals.
 *
 * **The routes are the real ones**: the document actions of
 * `document-actions.ts` over a real editor (File, Open; Open Recent; New; a
 * click in the tree; a link, which opens through `openFilePath` with the root
 * it keeps), and the door of the system, `setupFileAssociation`, with the path
 * the process holds handed through `listenForFileOpen`. The panel is the one
 * `setupSidebar` draws, redrawn by the real `refreshSidebar` with the gesture
 * of the window from `windowGesture`, and opened by hand through the real
 * `openSidebarByHand`, as `main.ts` wires them. The store is the localStorage
 * of the harness, kept across windows as the machine keeps it.
 *
 * The desktop alone is here, since `isTauri` is a module constant and
 * `vi.mock` is per file; the web build is in `panel-every-arrival-web.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, MarkdownTree, PlatformIO } from '../platform/types';
import { loadSidebarGesture, SIDEBAR_GESTURE_KEY, saveSidebarGesture } from '../preferences';
import { documentReferencesImage } from '../ui/document-badges';
import { FOLDER_CHECK_DOOR } from '../ui/links-folder-report';
import { LINKS_SLOT_CLASS, NO_RELATED_ITEMS, setupSidebar } from '../ui/sidebar';
import type { AppContext } from './context';
import { createDocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { setupFileAssociation } from './file-association';
import { createFolderLinkReport } from './folder-link-report';
import {
  openSidebarByHand,
  refreshSidebar,
  type SidebarRedraw,
  windowGesture,
} from './sidebar-sync';
import { AppState } from './state';

vi.mock('../platform/detect', () => ({ isTauri: true }));

/** The path the process holds for the window being started, handed once. */
const door: { open: ((path: string) => void) | null } = { open: null };
vi.mock('../platform/file-open', () => ({
  listenForFileOpen: async (open: (path: string) => void) => {
    door.open = open;
  },
}));

const DOC = '/notes/plan.md';
const OTHER = '/other/b.md';
const ALONE = '/alone/only.md';
const WITH_ASSETS = '/book/chapter.md';
const DEEP = '/proj/a.md';
const DEEPER = '/proj/sub/b.md';
const GONE = '/gone/missing.md';

const files: Record<string, string> = {
  [DOC]: '# Plan\n',
  '/notes/ideas.md': '# Ideas\n',
  [OTHER]: '# B\n',
  '/other/c.md': '# C\n',
  [ALONE]: '# Only\n',
  [WITH_ASSETS]: '# Chapter\n\n![c](assets/cover.png)\n',
  [DEEP]: '# A\n',
  [DEEPER]: '# B\n',
};

const trees: Record<string, MarkdownTree> = {
  '/notes': { files: ['plan.md', 'ideas.md'], reachedBound: false },
  '/other': { files: ['b.md', 'c.md'], reachedBound: false },
  '/alone': { files: ['only.md'], reachedBound: false },
  '/book': { files: ['chapter.md', 'assets/cover.png'], reachedBound: false },
  '/proj': { files: ['a.md', 'sub/b.md'], reachedBound: false },
  '/proj/sub': { files: ['b.md'], reachedBound: false },
};

/** One window: its panel, its document actions, and what it asked of the disk. */
interface Window {
  readonly walks: string[];
  readonly reads: string[];
  /** Every change of the panel between open and shut, in order. */
  readonly shown: boolean[];
  readonly state: AppState;
  readonly sidebar: ReturnType<typeof setupSidebar>;
  readonly actions: ReturnType<typeof createDocumentActions>;
  readonly settle: () => Promise<void>;
  readonly isOpen: () => boolean;
  readonly tree: () => HTMLElement;
  readonly rootName: () => string | undefined;
  /** Hold the walk of `root` until the returned function is called. */
  readonly hold: (root: string) => () => void;
  readonly folder: ReturnType<typeof createFolderLinkReport>;
}

let editors: EditorInstance[] = [];
let pickAnswer: string | null = null;
let saveAsAnswer: string | null = null;

function makeIO(walks: string[], reads: string[], held: Map<string, Promise<void>>): PlatformIO {
  return {
    canWriteCompanions: async () => true,
    openFile: async () =>
      pickAnswer === null ? null : { path: pickAnswer, content: files[pickAnswer] ?? '' },
    pickFile: async () => null,
    readText: async (path: string) => {
      reads.push(path);
      if (!(path in files)) throw new Error('not found: ' + path);
      return files[path];
    },
    saveFile: async () => {},
    readSnapshot: async (path: string) =>
      path in files ? { kind: 'file' as const, text: files[path] } : { kind: 'absent' as const },
    pickSavePath: async () => saveAsAnswer,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async (path: string): Promise<EntryPresence> =>
      path === '/book/assets' || path in files ? 'present' : 'absent',
    listDir: async () => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
    pathsOutliveSession: true,
    markdownTree: async (_document: string, root: string) => {
      walks.push(root);
      await held.get(root);
      return trees[root] ?? { files: [], reachedBound: false };
    },
  } as PlatformIO;
}

const quiet = { silent: () => {}, toast: () => {}, dialog: async () => {} };

let currentIO: PlatformIO;
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => currentIO) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * Start a window as `main.ts` wires it, and hand it `path` through the door
 * when given, as a launch with a file does. Resolves once the document is on
 * screen and the panel has drawn what it draws.
 */
async function start(path: string | null): Promise<Window> {
  document.body.innerHTML =
    '<aside id="sidebar" class="hidden"><div id="sidebar-tree"></div></aside>' +
    '<div id="sidebar-links-status"></div><div id="editor-host"></div>';
  door.open = null;
  const walks: string[] = [];
  const reads: string[] = [];
  const shown: boolean[] = [];
  const held = new Map<string, Promise<void>>();
  const io = makeIO(walks, reads, held);
  currentIO = io;
  const sidebar = setupSidebar();
  sidebar.onVisibleChange((visible) => shown.push(visible));
  const state = new AppState();
  const editor = createEditor(document.getElementById('editor-host') as HTMLElement);
  editors.push(editor);
  const pending: Array<Promise<unknown>> = [];
  const kept = windowGesture(loadSidebarGesture, saveSidebarGesture, sidebar);
  sidebar.setOnOpenByHand((ticket) => {
    pending.push(openSidebarByHand(state, sidebar, io, ticket));
  });
  const folder = createFolderLinkReport({
    io: async () => io,
    schema: editor.editor.schema,
    openDocument: () => null,
    status: document.getElementById('sidebar-links-status'),
    openFile: async () => {},
    jump: () => {},
  });
  sidebar.setOnMarkdownTree?.((tree) => folder.attach(tree));
  const actions = createDocumentActions({
    state,
    reporter: quiet,
    editor: editor.editor,
    getMarkdown: editor.getMarkdown,
    setMarkdown: editor.setMarkdown,
    refreshSidebar: (redraw?: SidebarRedraw) => {
      state.referencesImage = documentReferencesImage(editor.editor);
      return refreshSidebar(state, sidebar, io, redraw, kept);
    },
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar,
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext);
  // A click in the tree opens through the gate with the root it came from.
  sidebar.setOnFileClick((absPath, root) => {
    pending.push(actions.openFilePath(absPath, root));
  });
  setupFileAssociation(
    (handed) => {
      const run = actions.openFilePath(handed);
      pending.push(run);
      return run;
    },
    quiet as unknown as ErrorReporter,
  );
  await vi.waitFor(() => expect(door.open).not.toBeNull());
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.all(pending.splice(0));
  };
  if (path !== null) {
    // Read again: the listener was installed after `door.open` was cleared above.
    const handOver = door.open as ((handed: string) => void) | null;
    handOver?.(path);
    await settle();
  }
  const panel = document.getElementById('sidebar') as HTMLElement;
  const tree = () => document.getElementById('sidebar-tree') as HTMLElement;
  return {
    walks,
    reads,
    shown,
    state,
    sidebar,
    actions,
    settle,
    folder,
    isOpen: () => !panel.classList.contains('hidden'),
    tree,
    rootName: () =>
      tree()
        .querySelector('.sidebar-root')
        ?.textContent?.replace(/^\S+\s/, ''),
    hold: (root) => {
      let release: () => void = () => {};
      held.set(
        root,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        held.delete(root);
        release();
      };
    },
  };
}

/** Open the panel by hand and wait for its answer. */
async function openByHand(w: Window): Promise<void> {
  w.sidebar.toggle();
  await w.settle();
}

/** File, Open, answering the picker with `path`. */
async function fileOpen(w: Window, path: string): Promise<void> {
  pickAnswer = path;
  await w.actions.handleOpen();
  await w.settle();
}

/** A click on the entry of the tree whose name is `name`. */
async function clickEntry(w: Window, name: string): Promise<void> {
  const entry = [...w.tree().querySelectorAll<HTMLElement>('.sidebar-file-entry')].find((el) =>
    el.textContent?.endsWith(name),
  );
  if (!entry) throw new Error('no entry ' + name);
  entry.click();
  await w.settle();
}

const stored = () => localStorage.getItem(SIDEBAR_GESTURE_KEY);

beforeEach(() => {
  localStorage.clear();
  pickAnswer = null;
  saveAsAnswer = null;
});
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  localStorage.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the panel at every arrival, the gesture remembered open (#790)', () => {
  it('row 1: opened by hand, then File, Open of a plain document in another folder: open, with the tree of that folder', async () => {
    const w = await start(DOC);
    await openByHand(w);
    await fileOpen(w, OTHER);
    expect(w.isOpen()).toBe(true);
    expect(w.rootName()).toBe('other');
    expect(w.tree().textContent).toContain('c.md');
  });

  it('row 2: the same by Open Recent', async () => {
    const w = await start(DOC);
    await openByHand(w);
    await w.actions.openRecentFile(OTHER);
    await w.settle();
    expect(w.isOpen()).toBe(true);
    expect(w.rootName()).toBe('other');
  });

  it('row 3: showing No related files or folders, then a link to a document elsewhere: open, with what an open by hand draws there', async () => {
    const w = await start(ALONE);
    await openByHand(w);
    expect(w.tree().textContent).toBe(NO_RELATED_ITEMS);
    // A link opens through `openFilePath` with the root the panel lists, none here.
    expect(w.sidebar.listedRoot()).toBeNull();
    await w.actions.openFilePath(OTHER, w.sidebar.listedRoot() ?? undefined);
    await w.settle();
    expect(w.isOpen()).toBe(true);
    expect(w.rootName()).toBe('other');
  });

  it('row 4: New hides it, File, Open opens it again, and what is remembered was never rewritten', async () => {
    const w = await start(DOC);
    await openByHand(w);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await w.actions.handleNew();
    expect(w.isOpen()).toBe(false);
    await fileOpen(w, OTHER);
    expect(w.isOpen()).toBe(true);
    expect(writes.mock.calls.filter(([key]) => key === SIDEBAR_GESTURE_KEY)).toEqual([]);
    expect(stored()).toBe('open');
  });

  it('row 7: a click in the tree keeps the root it had, as on main', async () => {
    const w = await start(DEEP);
    await openByHand(w);
    expect(w.rootName()).toBe('proj');
    await clickEntry(w, 'b.md');
    expect(w.state.filePath).toBe(DEEPER);
    expect(w.isOpen()).toBe(true);
    expect(w.rootName()).toBe('proj');
  });

  it('row 8: across an arrival the panel is never hidden in between: one draw, and the folder read once', async () => {
    const w = await start(DOC);
    await openByHand(w);
    w.shown.length = 0;
    w.walks.length = 0;
    await fileOpen(w, ALONE);
    expect(w.shown).toEqual([true]);
    expect(w.walks).toEqual(['/alone']);
    expect(w.tree().textContent).toBe(NO_RELATED_ITEMS);
    w.shown.length = 0;
    w.walks.length = 0;
    await fileOpen(w, OTHER);
    expect(w.shown).toEqual([true]);
    expect(w.walks).toEqual(['/other']);
  });

  it('row 8: a panel shut by New opens again holding the reading mark, then its answer, the folder read once', async () => {
    const w = await start(DOC);
    await openByHand(w);
    await w.actions.handleNew();
    w.walks.length = 0;
    const release = w.hold('/other');
    pickAnswer = OTHER;
    const opening = w.actions.handleOpen();
    await vi.waitFor(() => expect(w.isOpen()).toBe(true));
    expect(w.tree().querySelector('.sidebar-reading')).not.toBeNull();
    release();
    await opening;
    await w.settle();
    expect(w.rootName()).toBe('other');
    expect(w.walks).toEqual(['/other']);
  });

  it('row 11: a read overtaken by a newer arrival draws nothing (#380)', async () => {
    const w = await start(DOC);
    await openByHand(w);
    const release = w.hold('/other');
    pickAnswer = OTHER;
    const first = w.actions.handleOpen();
    await vi.waitFor(() => expect(w.walks).toContain('/other'));
    await fileOpen(w, ALONE);
    release();
    await first;
    await w.settle();
    // The second open is the document on screen; the read of the first,
    // landing after it, draws nothing over its answer.
    expect(w.state.filePath).toBe(ALONE);
    expect(w.tree().textContent).toBe(NO_RELATED_ITEMS);
    expect(w.rootName()).toBeUndefined();
  });

  it('a Save As that gives an Untitled document its first file is the same document: the panel stays shut, as on main', async () => {
    const w = await start(DOC);
    await openByHand(w);
    await w.actions.handleNew();
    expect(w.isOpen()).toBe(false);
    w.walks.length = 0;
    saveAsAnswer = '/other/new.md';
    await w.actions.handleSaveAs();
    await w.settle();
    expect(w.state.filePath).toBe('/other/new.md');
    expect(w.isOpen()).toBe(false);
    expect(w.walks).toEqual([]);
  });

  it('a save while the panel shows a sentence keeps it, where it used to hide it', async () => {
    const w = await start(ALONE);
    await openByHand(w);
    await w.actions.handleSave();
    await w.settle();
    expect(w.isOpen()).toBe(true);
    expect(w.tree().textContent).toBe(NO_RELATED_ITEMS);
  });

  it('the report of the check of links stays for a document of the same folder, and goes for another folder', async () => {
    const w = await start(DOC);
    await openByHand(w);
    const slot = () => w.tree().querySelector('.' + LINKS_SLOT_CLASS) as HTMLElement;
    // Drawn as a door, and nothing read for it: the check never runs on its own.
    expect(slot().textContent).toContain(FOLDER_CHECK_DOOR);
    expect(w.reads).toEqual([DOC]);
    const door = [...slot().querySelectorAll('button')].find(
      (b) => b.textContent === FOLDER_CHECK_DOOR,
    ) as HTMLButtonElement;
    door.click();
    await w.folder.settled();
    const report = slot().textContent;
    expect(report).not.toContain(FOLDER_CHECK_DOOR);
    await fileOpen(w, '/notes/ideas.md');
    expect(w.rootName()).toBe('notes');
    expect(slot().textContent).toBe(report);
    await fileOpen(w, OTHER);
    expect(w.rootName()).toBe('other');
    expect(slot().textContent).toContain(FOLDER_CHECK_DOOR);
  });
});

describe('the panel at every arrival, the gesture shut or nothing stored (#790)', () => {
  it('row 5: shut by hand, then File, Open of a plain document: shut', async () => {
    const w = await start(DOC);
    await openByHand(w);
    w.sidebar.toggle();
    await fileOpen(w, OTHER);
    expect(w.isOpen()).toBe(false);
    expect(w.walks.filter((r) => r === '/other')).toEqual([]);
  });

  it('row 6: shut by hand, then File, Open of a document with an assets folder it references: raised by itself, and nothing written', async () => {
    const w = await start(DOC);
    await openByHand(w);
    w.sidebar.toggle();
    expect(stored()).toBe('shut');
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await fileOpen(w, WITH_ASSETS);
    expect(w.isOpen()).toBe(true);
    expect(writes.mock.calls.filter(([key]) => key === SIDEBAR_GESTURE_KEY)).toEqual([]);
    expect(stored()).toBe('shut');
  });

  it('nothing stored: every arrival is as on main, only an assets folder raises it', async () => {
    const w = await start(null);
    await fileOpen(w, OTHER);
    expect(w.isOpen()).toBe(false);
    await fileOpen(w, WITH_ASSETS);
    expect(w.isOpen()).toBe(true);
    await fileOpen(w, ALONE);
    expect(w.isOpen()).toBe(false);
    expect(stored()).toBeNull();
  });
});

describe('the start of #788, now an arrival like any other (#790)', () => {
  it('#788 row 1: opened by hand, then a new start with a file: open, with the tree of that document', async () => {
    const first = await start(DOC);
    await openByHand(first);
    expect(stored()).toBe('open');
    const next = await start(DOC);
    expect(next.isOpen()).toBe(true);
    expect(next.rootName()).toBe('notes');
    expect(next.tree().textContent).toContain('ideas.md');
  });

  it('#788 row 2: shut by hand, then a new start with a file: shut, nothing read', async () => {
    const first = await start(DOC);
    await openByHand(first);
    first.sidebar.toggle();
    expect(stored()).toBe('shut');
    const next = await start(DOC);
    expect(next.isOpen()).toBe(false);
    expect(next.walks).toEqual([]);
  });

  it('#788 row 3: nothing stored: shut and nothing read, as on main', async () => {
    const w = await start(DOC);
    expect(w.isOpen()).toBe(false);
    expect(w.walks).toEqual([]);
    expect(stored()).toBeNull();
  });

  it('#788 row 4: a panel raised by an assets folder, never touched: nothing written, and the next start on a plain document shut', async () => {
    const raised = await start(WITH_ASSETS);
    expect(raised.isOpen()).toBe(true);
    expect(stored()).toBeNull();
    const next = await start(DOC);
    expect(next.isOpen()).toBe(false);
  });

  it('#788 row 5: a start with the empty Untitled document: shut, and what is remembered unchanged; a first open that failed asks nothing', async () => {
    saveSidebarGesture('open');
    const untitled = await start(null);
    expect(untitled.isOpen()).toBe(false);
    expect(stored()).toBe('open');
    const failed = await start(GONE);
    expect(failed.state.filePath).toBeNull();
    expect(failed.isOpen()).toBe(false);
    expect(failed.walks).toEqual([]);
  });

  it('#788 row 7: the gesture is written at the gesture, under its key; a value that cannot be read is nothing stored', async () => {
    const w = await start(DOC);
    w.sidebar.toggle();
    expect(SIDEBAR_GESTURE_KEY).toBe('agented:sidebar-open');
    expect(stored()).toBe('open');
    await w.settle();
    w.sidebar.toggle();
    expect(stored()).toBe('shut');
    localStorage.setItem(SIDEBAR_GESTURE_KEY, 'true');
    const next = await start(DOC);
    expect(next.isOpen()).toBe(false);
  });

  it('#788 row 8: at a start the folder is read once; with an assets folder the arrival draws it, once', async () => {
    saveSidebarGesture('open');
    const plain = await start(DOC);
    expect(plain.isOpen()).toBe(true);
    expect(plain.walks).toEqual(['/notes']);
    const raised = await start(WITH_ASSETS);
    expect(raised.isOpen()).toBe(true);
    expect(raised.walks).toEqual(['/book']);
  });

  it('#788 row 9: opened at a start, then shut by hand: shut through a save, by #387, and at the next start', async () => {
    saveSidebarGesture('open');
    const w = await start(DOC);
    expect(w.isOpen()).toBe(true);
    w.sidebar.toggle();
    await w.actions.handleSave();
    await w.settle();
    expect(w.isOpen()).toBe(false);
    expect(stored()).toBe('shut');
    const next = await start(DOC);
    expect(next.isOpen()).toBe(false);
  });

  it('#788 row 10: a window of its own reads what is remembered, and a later gesture in another window leaves it as it is', async () => {
    saveSidebarGesture('open');
    const linked = await start(ALONE);
    expect(linked.isOpen()).toBe(true);
    // Another window shuts its panel: this window keeps its own gesture, and
    // its next arrival still opens the panel.
    saveSidebarGesture('shut');
    await linked.actions.handleNew();
    await fileOpen(linked, OTHER);
    expect(linked.isOpen()).toBe(true);
  });

  it('#788: a document alone in its folder answers No related files or folders at a start', async () => {
    saveSidebarGesture('open');
    const w = await start(ALONE);
    expect(w.isOpen()).toBe(true);
    expect(w.tree().textContent).toBe(NO_RELATED_ITEMS);
  });
});
