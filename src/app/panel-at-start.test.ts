/**
 * #788 - the files panel opens again at a start when it was last opened by
 * hand (owner decision of 2026-11-24).
 *
 * **Each start here is a window started**: a page wiring the real panel
 * (`setupSidebar`), the real open by hand of `sidebar-sync.ts`, the real store
 * of `preferences.ts` and the real door of `setupFileAssociation`, with the
 * path the process holds handed through `listenForFileOpen`, as `main.ts`
 * wires them. The arrival of the document is the real `refreshSidebar` of a
 * document arriving, after the path is put on screen. The store is the
 * localStorage of the harness, kept across starts as the machine keeps it.
 *
 * The desktop door alone is here, since `isTauri` is a module constant and
 * `vi.mock` is per file; the web build is in `panel-at-start-web.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor } from '../editor/setup';
import type { MarkdownTree, PlatformIO } from '../platform/types';
import { loadSidebarGesture, SIDEBAR_GESTURE_KEY, saveSidebarGesture } from '../preferences';
import { FOLDER_CHECK_DOOR } from '../ui/links-folder-report';
import { LINKS_SLOT_CLASS, NO_RELATED_ITEMS, setupSidebar } from '../ui/sidebar';
import type { ErrorReporter } from './error-reporter';
import { setupFileAssociation } from './file-association';
import { createFolderLinkReport } from './folder-link-report';
import { openPanelAtStart } from './panel-at-start';
import { openSidebarByHand, refreshSidebar } from './sidebar-sync';
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
const ALONE = '/alone/only.md';
const WITH_ASSETS = '/book/chapter.md';
/** A file that cannot be read: its open fails and leaves the window as it was. */
const GONE = '/gone/missing.md';

interface Disk {
  /** Every call of the markdown walk, by root. */
  readonly walks: string[];
  /** Every file read, which a check of links would do. */
  readonly reads: string[];
  readonly io: PlatformIO;
}

function disk(): Disk {
  const walks: string[] = [];
  const reads: string[] = [];
  const trees: Record<string, MarkdownTree> = {
    '/notes': { files: ['plan.md', 'ideas.md'], reachedBound: false },
    '/alone': { files: ['only.md'], reachedBound: false },
    '/book': { files: ['chapter.md', 'assets/cover.png'], reachedBound: false },
  };
  const io: PlatformIO = {
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async (path: string) => {
      reads.push(path);
      return '';
    },
    saveFile: async () => {},
    readSnapshot: async () => ({ kind: 'absent' as const }),
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async (path: string) => (path === '/book/assets' ? 'present' : 'absent'),
    listDir: async () => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
    markdownTree: async (_document: string, root: string) => {
      walks.push(root);
      return trees[root] ?? { files: [], reachedBound: false };
    },
  };
  return { walks, reads, io };
}

const reporter = { dialog: vi.fn(async () => {}) } as unknown as ErrorReporter;

/**
 * Start a window: the page wired as `main.ts` wires it, and `path`, when
 * given, handed by the process as a launch with a file hands it. Resolves once
 * the document is on screen and the panel has drawn what it draws.
 */
async function start(path: string | null, d: Disk = disk()) {
  document.body.innerHTML =
    '<aside id="sidebar" class="hidden"><div id="sidebar-tree"></div></aside>' +
    '<div id="sidebar-links-status"></div><div id="editor-host"></div>';
  door.open = null;
  const sidebar = setupSidebar();
  const state = new AppState();
  const drawn: Array<Promise<void>> = [];
  sidebar.onGesture((opened) => saveSidebarGesture(opened ? 'open' : 'shut'));
  sidebar.setOnOpenByHand((ticket) => {
    drawn.push(openSidebarByHand(state, sidebar, d.io, ticket));
  });
  const editor = createEditor(document.getElementById('editor-host') as HTMLElement);
  const folder = createFolderLinkReport({
    io: async () => d.io,
    schema: editor.editor.schema,
    openDocument: () => null,
    status: document.getElementById('sidebar-links-status'),
    openFile: async () => {},
    jump: () => {},
  });
  sidebar.setOnMarkdownTree?.((tree) => folder.attach(tree));
  const arrival = async (arrived: string) => {
    if (arrived === GONE) return;
    state.filePath = arrived;
    state.referencesImage = arrived === WITH_ASSETS;
    await refreshSidebar(state, sidebar, d.io, 'document-arrived');
  };
  const askedToOpen = vi.spyOn(sidebar, 'openAsIfPressed');
  const opening = openPanelAtStart({
    open: arrival,
    remembered: loadSidebarGesture,
    filePath: () => state.filePath,
    panel: sidebar,
  });
  const opens: Array<Promise<void>> = [];
  setupFileAssociation((handed) => {
    const run = opening(handed);
    opens.push(run);
    return run;
  }, reporter);
  await vi.waitFor(() => expect(door.open).not.toBeNull());
  const settle = async () => {
    await Promise.all(opens);
    await Promise.all(drawn);
  };
  const hand = async (handed: string) => {
    door.open?.(handed);
    await settle();
  };
  if (path !== null) await hand(path);
  const panel = document.getElementById('sidebar') as HTMLElement;
  const tree = document.getElementById('sidebar-tree') as HTMLElement;
  return {
    sidebar,
    state,
    d,
    hand,
    settle,
    askedToOpen,
    folder,
    isOpen: () => !panel.classList.contains('hidden'),
    tree,
    destroy: () => editor.editor.destroy(),
  };
}

const stored = () => localStorage.getItem(SIDEBAR_GESTURE_KEY);

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the files panel at a start (#788)', () => {
  it('row 1: opened by hand, then a new start with a file: the panel opens, with the tree of that document', async () => {
    const first = await start(DOC);
    first.sidebar.toggle();
    await first.settle();
    expect(stored()).toBe('open');
    first.destroy();

    const next = await start(DOC);
    expect(next.isOpen()).toBe(true);
    expect(next.tree.querySelector('.sidebar-root')?.textContent).toContain('notes');
    expect(next.tree.textContent).toContain('ideas.md');
    next.destroy();
  });

  it('row 2: shut by hand, then a new start with a file: it stays shut', async () => {
    const first = await start(DOC);
    first.sidebar.toggle();
    await first.settle();
    first.sidebar.toggle();
    expect(stored()).toBe('shut');
    first.destroy();

    const next = await start(DOC);
    expect(next.isOpen()).toBe(false);
    expect(next.d.walks).toEqual([]);
    next.destroy();
  });

  it('row 3: nothing stored: it stays shut and nothing is read, as on main', async () => {
    const view = await start(DOC);
    expect(view.isOpen()).toBe(false);
    expect(view.d.walks).toEqual([]);
    expect(view.askedToOpen).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    view.destroy();
  });

  it('row 4: a panel raised by an assets folder, never touched: nothing is written, and the next start on a plain document stays shut', async () => {
    const raised = await start(WITH_ASSETS);
    expect(raised.isOpen()).toBe(true);
    expect(stored()).toBeNull();
    raised.destroy();

    const next = await start(DOC);
    expect(next.isOpen()).toBe(false);
    next.destroy();
  });

  it('row 5: opened by hand, then a start with the empty Untitled document: shut, and what is remembered is unchanged', async () => {
    saveSidebarGesture('open');
    const view = await start(null);
    expect(view.isOpen()).toBe(false);
    expect(view.askedToOpen).not.toHaveBeenCalled();
    expect(stored()).toBe('open');
    view.destroy();
  });

  it('row 5: a first open that failed leaves no file, and asks nothing', async () => {
    saveSidebarGesture('open');
    const view = await start(GONE);
    expect(view.isOpen()).toBe(false);
    expect(view.askedToOpen).not.toHaveBeenCalled();
    expect(stored()).toBe('open');
    view.destroy();
  });

  it('row 7: the gesture is written at the gesture, under its key, before the folder is read', async () => {
    const view = await start(DOC);
    view.sidebar.toggle();
    expect(SIDEBAR_GESTURE_KEY).toBe('agented:sidebar-open');
    expect(stored()).toBe('open');
    await view.settle();
    view.sidebar.toggle();
    expect(stored()).toBe('shut');
    view.destroy();
  });

  it('row 7: a value that cannot be read reads as nothing stored, and the start stays shut', async () => {
    localStorage.setItem(SIDEBAR_GESTURE_KEY, 'true');
    const view = await start(DOC);
    expect(view.isOpen()).toBe(false);
    view.destroy();
  });

  it('row 8: at a start the folder is read once and the open asked once, for a plain document', async () => {
    saveSidebarGesture('open');
    const view = await start(DOC);
    expect(view.isOpen()).toBe(true);
    expect(view.d.walks).toEqual(['/notes']);
    expect(view.askedToOpen).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('row 8: for a document whose assets folder raised the panel, the arrival draws and the open is not asked', async () => {
    saveSidebarGesture('open');
    const view = await start(WITH_ASSETS);
    expect(view.isOpen()).toBe(true);
    expect(view.d.walks).toEqual(['/book']);
    expect(view.askedToOpen).not.toHaveBeenCalled();
    view.destroy();
  });

  it('row 8: a second path handed to the same window is not a start, and asks nothing', async () => {
    saveSidebarGesture('open');
    const view = await start(DOC);
    view.sidebar.hide();
    await view.hand(ALONE);
    expect(view.isOpen()).toBe(false);
    expect(view.askedToOpen).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('row 9: opened at a start, then shut by hand: it stays shut by #387, and the next start stays shut', async () => {
    saveSidebarGesture('open');
    const view = await start(DOC);
    expect(view.isOpen()).toBe(true);
    view.sidebar.toggle();
    expect(view.isOpen()).toBe(false);
    await refreshSidebar(view.state, view.sidebar, view.d.io, 'same-document');
    expect(view.isOpen()).toBe(false);
    expect(stored()).toBe('shut');
    view.destroy();

    const next = await start(DOC);
    expect(next.isOpen()).toBe(false);
    next.destroy();
  });

  it('row 10: a window of its own from a link reads what is remembered as a start does, and open windows do not follow each other', async () => {
    const first = await start(DOC);
    first.sidebar.toggle();
    await first.settle();
    expect(stored()).toBe('open');
    first.destroy();

    // The link hands its path to a window of its own, as a launch with a file
    // hands it; a later gesture in another window leaves this one as it is.
    const linked = await start(ALONE);
    expect(linked.isOpen()).toBe(true);
    saveSidebarGesture('shut');
    expect(linked.isOpen()).toBe(true);
    linked.destroy();
  });

  it('a document alone in its folder opened at a start answers No related files or folders, as an open by hand does', async () => {
    saveSidebarGesture('open');
    const view = await start(ALONE);
    expect(view.isOpen()).toBe(true);
    expect(view.tree.textContent).toBe(NO_RELATED_ITEMS);
    view.destroy();
  });

  it('an open at a start draws the door of the check of links and no report: the check never runs on its own', async () => {
    saveSidebarGesture('open');
    const view = await start(DOC);
    const slot = view.tree.querySelector('.' + LINKS_SLOT_CLASS);
    expect(slot?.textContent).toContain(FOLDER_CHECK_DOOR);
    await view.folder.settled();
    expect(view.d.reads).toEqual([]);
    view.destroy();
  });
});
