import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { parseDocument } from '../editor/document-load';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { shippedElement } from '../test-support/shipped-markup';
import { setupDocumentBadges } from '../ui/document-badges';
import {
  FOLDER_CHECK_AGAIN,
  FOLDER_CHECK_CLEAR,
  FOLDER_CHECK_DOOR,
  FOLDER_RENAMED_LINE,
  stoppedLine,
} from '../ui/links-folder-report';
import { setupLinksPopover } from '../ui/links-popover';
import {
  HIDE_LINKS,
  LINKED_FROM_HEADING,
  LINKS_SECTION_ID,
  LINKS_SECTION_LABEL,
  LINKS_TO_HEADING,
  moreFilesLine,
  SECTION_ROWS,
  SHOW_LINKS,
} from '../ui/links-section';
import { buildTree, type Sidebar, setupSidebar } from '../ui/sidebar';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { createFolderLinkReport, type FolderLinkReport } from './folder-link-report';
import { checkOnArrival, createLinksReport, type LinksReport } from './links-report';
import { followRelativeLink } from './relative-link';
import { AppState } from './state';

vi.mock('../editor/document-load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../editor/document-load')>();
  return { ...actual, parseDocument: vi.fn(actual.parseDocument) };
});

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../ui/toast', () => ({ showToast: vi.fn((m: string) => toasts.push(m)) }));

const showConfirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog }));

const ROOT = '/notes/docs';
const A = `${ROOT}/a.md`;
const B = `${ROOT}/b.md`;
const C = `${ROOT}/c.md`;

let disk: Map<string, string>;
let folders: Set<string>;
let reads: string[];
let readGate: { path: string; open: Promise<void> } | null;
let unreadable: Set<string>;

const io = {
  pathsOutliveSession: true,
  canWriteCompanions: async () => true,
  readText: async (path: string) => {
    reads.push(path);
    if (readGate && readGate.path === path) await readGate.open;
    if (unreadable.has(path)) throw new Error(`permission denied: ${path}`);
    const text = disk.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  saveFile: async (path: string, content: string) => {
    disk.set(path, content);
  },
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => null,
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: async (path: string): Promise<EntryPresence> =>
    disk.has(path) || folders.has(path) ? 'present' : 'absent',
  listDir: async (path: string): Promise<FileEntry[]> =>
    [...disk.keys(), ...folders]
      .filter((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'))
      .map((p) => ({ name: p.slice(path.length + 1), path: p, isDirectory: folders.has(p) })),
  mkdir: async () => {},
  openWithSystem: vi.fn(async () => {}),
} as unknown as PlatformIO;

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));

const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };

let state: AppState;
let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;
let linksReport: LinksReport;
let sidebar: Sidebar;
let folder: FolderLinkReport;
let runs: Array<Promise<void>>;
let shownFiles: string[];
let shownRoot: string;
/** The text selected at the moment of each jump. */
let jumped: string[];
/** Each row of Links to followed, to wait for. */
let followed: Array<Promise<void>>;

function drawTree(root = shownRoot, files = shownFiles): void {
  shownRoot = root;
  shownFiles = files;
  sidebar.showTree(
    buildTree(files.map((path) => ({ path, kind: 'file' as const }))),
    root.split('/').pop() ?? root,
    root,
    true,
    { reachedBound: false, files },
  );
}

beforeEach(() => {
  localStorage.clear();
  toasts.length = 0;
  reads = [];
  jumped = [];
  followed = [];
  readGate = null;
  unreadable = new Set();
  showConfirmDialog.mockReset();
  vi.mocked(parseDocument).mockClear();
  disk = new Map([
    [A, '# Alpha\n\n[good](b.md) and [gone](gone.md)\n'],
    [B, '# Beta\n\n[back](a.md)\n'],
    [C, '# Gamma\n\n[home](a.md)\n'],
  ]);
  folders = new Set(['/notes', ROOT]);
  clearImages();
  document.body.innerHTML = [
    shippedElement(shippedPage, '<div id="header-indicators">'),
    shippedElement(shippedPage, '<aside id="links-popover"'),
    shippedElement(shippedPage, '<aside id="sidebar"'),
  ].join('');
  state = new AppState();
  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host, () => state.setModified(true));
  const popover = setupLinksPopover({ onJump: (link) => linksReport.jump(link) });
  const badges = setupDocumentBadges(instance.editor, {
    onImagesToggle: () => {},
    onLinksToggle: () => popover.toggle(),
  });
  linksReport = createLinksReport({
    editor: instance.editor,
    documentPath: () => state.filePath,
    io: async () => io,
    refreshBadge: (n) => badges.refreshLinks(n),
    popover,
    onChecked: (path, result) => folder.openFileChecked(path, result),
  });
  runs = [];
  const run = () => {
    runs.push(linksReport.run());
  };
  checkOnArrival(instance.editor, run, (fn) => fn());
  sidebar = setupSidebar();
  shownRoot = ROOT;
  shownFiles = ['a.md', 'b.md', 'c.md'];
  actions = createDocumentActions({
    state,
    reporter,
    editor: instance.editor,
    getMarkdown: instance.getMarkdown,
    setMarkdown: instance.setMarkdown,
    // An open redraws the panel on the folder it shows, as the application does.
    refreshSidebar: async () => drawTree(),
    setFilename: () => {},
    updateCloseEnabled: () => {},
    checkLinks: run,
    sidebar,
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext);
  folder = createFolderLinkReport({
    io: async () => io,
    schema: instance.editor.schema,
    openDocument: () =>
      state.filePath === null ? null : { path: state.filePath, doc: instance.editor.state.doc },
    status: document.getElementById('sidebar-links-status'),
    openFile: (path, root) => actions.openFilePath(path, root),
    jump: (link) => {
      linksReport.jump(link);
      const { from, to } = instance.editor.state.selection;
      jumped.push(instance.editor.state.doc.textBetween(from, to));
    },
    section: document.getElementById('sidebar-links-section'),
    followLink: (link) => {
      followed.push(
        followRelativeLink(
          {
            documentPath: () => state.filePath,
            panelRoot: () => sidebar.listedRoot(),
            io: async () => io,
            openFilePath: (path, root) => actions.openFilePath(path, root),
            tell: (m) => toasts.push(m),
          },
          link.href,
        ),
      );
    },
  });
  sidebar.setOnMarkdownTree?.((drawn) => folder.attach(drawn));
});

afterEach(() => {
  instance.destroy();
  document.body.innerHTML = '';
});

async function open(path: string): Promise<void> {
  await actions.openFilePath(path);
  await Promise.all(runs);
}

const slot = () => document.querySelector('.sidebar-links-slot') as HTMLElement | null;

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(slot()?.querySelectorAll('button') ?? []).find((b) => b.textContent === text);
}

async function check(): Promise<void> {
  const door = button(FOLDER_CHECK_DOOR) ?? button(FOLDER_CHECK_AGAIN);
  if (!door) throw new Error('no door to press');
  door.click();
  await folder.settled();
}

const counts = () => slot()?.querySelector('.links-folder-counts')?.textContent;

function writeLink(text: string, href: string): void {
  const s = instance.editor.state;
  const type = s.schema.marks.link;
  instance.editor.view.dispatch(
    s.tr.insertText(text, 1).addMark(1, 1 + text.length, type.create({ href })),
  );
}

const section = () => document.getElementById('sidebar-links-section') as HTMLElement;
const toggle = () => document.querySelector<HTMLButtonElement>('.links-section-toggle');

async function showLinks(): Promise<void> {
  const b = toggle();
  if (!b) throw new Error('no line Show links');
  b.click();
}

/** The heading texts of the section, in order. */
const headings = () =>
  Array.from(section().querySelectorAll('.links-section-heading')).map((h) => h.textContent);

/** The rows of the two lists, by heading: Links to first, Linked from second. */
function lists(): { to: string[]; from: string[] } {
  const out = { to: [] as string[], from: [] as string[] };
  let into: string[] | null = null;
  for (const node of Array.from(section().children)) {
    if (node.classList.contains('links-section-heading')) {
      into = node.textContent?.startsWith(LINKS_TO_HEADING) ? out.to : out.from;
    } else if (node.classList.contains('links-section-list') && into) {
      into.push(
        ...Array.from(node.querySelectorAll('.links-section-row')).map((r) => r.textContent ?? ''),
      );
    }
  }
  return out;
}

function sectionRow(name: string): HTMLButtonElement {
  const row = Array.from(section().querySelectorAll<HTMLButtonElement>('.links-section-row')).find(
    (r) => r.textContent === name,
  );
  if (!row) throw new Error(`no row ${name}`);
  return row;
}

const notesOfSection = () =>
  Array.from(section().querySelectorAll('.links-section-note')).map((n) => n.textContent);

/** Hold the read of `path` until the returned function is called. */
function holdRead(path: string): () => void {
  let release = () => {};
  readGate = {
    path,
    open: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  return () => {
    readGate = null;
    release();
  };
}

describe('Show links, by hand (#797)', () => {
  it('row 1: no read standing: Links to at once, the read starts, Linked from runs, then both lists and the report stand', async () => {
    await open(A);
    drawTree();
    const release = holdRead(C);
    await showLinks();
    expect(section().classList.contains('hidden')).toBe(false);
    expect(lists().to).toEqual(['b.md']);
    expect(headings()).toEqual([`${LINKS_TO_HEADING} · 1`, LINKED_FROM_HEADING]);
    expect(section().querySelector('.links-section-running')).not.toBeNull();
    release();
    await folder.settled();
    expect(lists()).toEqual({ to: ['b.md'], from: ['b.md', 'c.md'] });
    expect(counts()).toBe('1 broken link in 1 of 3 files');
  });

  it('row 2: a read standing: both lists at once, and no file is read again', async () => {
    await open(A);
    drawTree();
    await check();
    reads.length = 0;
    await showLinks();
    expect(lists()).toEqual({ to: ['b.md'], from: ['b.md', 'c.md'] });
    await folder.settled();
    expect(reads).toEqual([]);
  });

  it('row 3: Hide links shuts the section and keeps the read and the report', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    expect(toggle()?.textContent).toBe(HIDE_LINKS);
    await showLinks();
    expect(section().classList.contains('hidden')).toBe(true);
    expect(section().children.length).toBe(0);
    expect(counts()).toBe('1 broken link in 1 of 3 files');
    expect(toggle()?.textContent).toBe(SHOW_LINKS);
  });

  it('row 4: Links to holds each found file once, markdown or not, inside the folder or outside, and no link that leads nowhere', async () => {
    disk.set('/notes/outside.md', '# Outside\n');
    disk.set(`${ROOT}/sub/x.pdf`, '');
    folders.add(`${ROOT}/sub`);
    disk.set(
      A,
      '# Alpha\n\n[b](b.md) [b again](./b.md) [pdf](sub/x.pdf) [out](../outside.md) [gone](gone.md) [rooted](/r.md) [web](www.example.com) [h](#h)\n',
    );
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    expect(lists().to).toEqual(['../outside.md', 'b.md', 'sub/x.pdf']);
    expect(notesOfSection()).toEqual([]);
  });

  it('row 5: Linked from holds the markdown files of the read that link to the document, each once, and not the document itself', async () => {
    disk.set(A, '# Alpha\n\n[me](a.md) [b](b.md)\n');
    disk.set(B, '# Beta\n\n[a](a.md) and [a again](./a.md)\n');
    disk.set(C, '# Gamma\n\nNo link.\n');
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    expect(lists().from).toEqual(['b.md']);
  });

  it('row 6: a list of 101 files shows 100 rows and the line of one more', async () => {
    const names = Array.from({ length: 101 }, (_, i) => `f${String(i).padStart(3, '0')}.md`);
    for (const n of names) disk.set(`${ROOT}/${n}`, '# F\n');
    disk.set(A, `# Alpha\n\n${names.map((n) => `[${n}](${n})`).join(' ')}\n`);
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    expect(SECTION_ROWS).toBe(100);
    expect(lists().to).toHaveLength(100);
    expect(notesOfSection()).toEqual([moreFilesLine(1)]);
    expect(moreFilesLine(1)).toBe('1 more file not listed');
  });

  it('row 7: a click on a Linked from row passes the question; Cancel changes nothing; then the file opens and the section follows it', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    instance.editor.commands.insertContentAt(1, 'E');
    showConfirmDialog.mockResolvedValue('cancel');
    sectionRow('c.md').click();
    await vi.waitFor(() => expect(showConfirmDialog).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(state.filePath).toBe(A);
    expect(lists().from).toEqual(['b.md', 'c.md']);
    showConfirmDialog.mockResolvedValue('discard');
    sectionRow('c.md').click();
    await vi.waitFor(() => expect(state.filePath).toBe(C));
    await Promise.all(runs);
    expect(lists()).toEqual({ to: ['a.md'], from: [] });
  });

  it('row 8: a click on a Links to row does what Ctrl and a click does: a markdown file, a file of another kind, a file outside the folder', async () => {
    disk.set('/notes/outside.md', '# Outside\n');
    disk.set(`${ROOT}/x.pdf`, '');
    disk.set(A, '# Alpha\n\n[b](b.md) [pdf](x.pdf) [out](../outside.md)\n');
    (io as { opensFilesWithSystem?: boolean }).opensFilesWithSystem = true;
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    sectionRow('x.pdf').click();
    await Promise.all(followed);
    expect(io.openWithSystem).toHaveBeenCalled();
    expect(state.filePath).toBe(A);
    sectionRow('b.md').click();
    await Promise.all(followed);
    expect(state.filePath).toBe(B);
    await open(A);
    drawTree();
    sectionRow('../outside.md').click();
    await Promise.all(followed);
    expect(state.filePath).toBe('/notes/outside.md');
    delete (io as { opensFilesWithSystem?: boolean }).opensFilesWithSystem;
  });

  it('row 9: a click in the tree: the section stays and follows', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    await actions.openFilePath(B, sidebar.listedRoot() ?? undefined);
    await Promise.all(runs);
    expect(section().classList.contains('hidden')).toBe(false);
    expect(lists()).toEqual({ to: ['a.md'], from: ['a.md'] });
  });

  it('row 10: a document of another folder: the section and the report go, the panel stays', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    disk.set('/other/x.md', '# X\n');
    await actions.openFilePath('/other/x.md');
    drawTree('/other', ['x.md']);
    expect(sidebar.isVisible()).toBe(true);
    expect(section().classList.contains('hidden')).toBe(true);
    expect(counts()).toBeUndefined();
    expect(toggle()?.textContent).toBe(SHOW_LINKS);
  });

  it('row 11: the document saved with a new link: Links to follows with no check again, Linked from unchanged', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    reads.length = 0;
    writeLink('gamma ', 'c.md');
    await actions.handleSave();
    await Promise.all(runs);
    expect(lists()).toEqual({ to: ['b.md', 'c.md'], from: ['b.md', 'c.md'] });
    expect(reads.filter((p) => p === B || p === C)).toEqual([]);
  });

  it('row 11: saved while the read the section started still runs: Links to follows at once', async () => {
    await open(A);
    drawTree();
    const release = holdRead(C);
    await showLinks();
    writeLink('gamma ', 'c.md');
    await actions.handleSave();
    await Promise.all(runs);
    expect(lists().to).toEqual(['b.md', 'c.md']);
    expect(section().querySelector('.links-section-running')).not.toBeNull();
    release();
    await folder.settled();
  });

  it('row 12: Check again with the section shown: Links to stays, Linked from runs and is drawn anew', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    disk.set(C, '# Gamma\n\nNo link now.\n');
    const release = holdRead(C);
    button(FOLDER_CHECK_AGAIN)?.click();
    expect(lists().to).toEqual(['b.md']);
    expect(section().querySelector('.links-section-running')).not.toBeNull();
    release();
    await folder.settled();
    expect(lists()).toEqual({ to: ['b.md'], from: ['b.md'] });
  });

  it('row 13: Stop during a read the section started: the words of the report under Linked from, and what was read is listed', async () => {
    await open(A);
    drawTree();
    const release = holdRead(B);
    await showLinks();
    await vi.waitFor(() => expect(reads).toContain(B));
    (section().querySelector('.links-section-running button') as HTMLButtonElement).click();
    release();
    await folder.settled();
    expect(notesOfSection()).toContain(stoppedLine(2, 3));
    expect(lists().from).toEqual(['b.md']);
  });

  it('row 14: Clear shuts the section', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    button(FOLDER_CHECK_CLEAR)?.click();
    expect(section().classList.contains('hidden')).toBe(true);
    expect(toggle()?.textContent).toBe(SHOW_LINKS);
  });

  it('row 15: the panel shut and opened: no section, the line reads Show links; nothing is stored for a new start', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    sidebar.hide();
    expect(section().classList.contains('hidden')).toBe(true);
    expect(section().children.length).toBe(0);
    drawTree();
    expect(section().classList.contains('hidden')).toBe(true);
    expect(toggle()?.textContent).toBe(SHOW_LINKS);
    expect(Object.keys(localStorage).filter((k) => k.includes('link'))).toEqual([]);
  });

  it('row 16: a document with no file, and a panel with no markdown tree as the web build draws it: no line', async () => {
    drawTree();
    expect(state.filePath).toBeNull();
    expect(toggle()).toBeNull();
    await open(A);
    sidebar.showNothingRelated();
    expect(toggle()).toBeNull();
    expect(section().classList.contains('hidden')).toBe(true);
  });

  it('row 17: after File, Rename of a file of the read, the line of a rename stands under Linked from', async () => {
    await open(A);
    drawTree();
    await showLinks();
    await folder.settled();
    folder.renamed(C, `${ROOT}/c2.md`);
    expect(notesOfSection()).toContain(FOLDER_RENAMED_LINE);
  });

  it('row 18: the line is a button with aria-expanded and aria-controls; the section a named region; each heading carries its count', async () => {
    await open(A);
    drawTree();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    await showLinks();
    await folder.settled();
    const b = toggle() as HTMLButtonElement;
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(b.getAttribute('aria-controls')).toBe(LINKS_SECTION_ID);
    expect(section().getAttribute('aria-label')).toBe(LINKS_SECTION_LABEL);
    expect(section().tagName).toBe('SECTION');
    for (const h of Array.from(section().querySelectorAll('.links-section-heading'))) {
      expect(h.getAttribute('role')).toBe('heading');
      expect(h.getAttribute('aria-level')).toBe('3');
    }
    expect(headings()).toEqual([`${LINKS_TO_HEADING} · 1`, `${LINKED_FROM_HEADING} · 2`]);
  });

  it('row 18: the focus stays on the line pressed, through the read', async () => {
    await open(A);
    drawTree();
    toggle()?.focus();
    await showLinks();
    expect(document.activeElement).toBe(toggle());
    await folder.settled();
    expect(document.activeElement).toBe(toggle());
    expect(toggle()?.textContent).toBe(HIDE_LINKS);
  });

  it('row 19: the section never starts a read without a press, at any arrival', async () => {
    await open(A);
    drawTree();
    await open(B);
    drawTree();
    await actions.openFilePath(C, sidebar.listedRoot() ?? undefined);
    await Promise.all(runs);
    expect(reads.filter((p) => p !== A && p !== B && p !== C)).toEqual([]);
    expect(reads.filter((p) => p === A)).toHaveLength(1);
    expect(section().classList.contains('hidden')).toBe(true);
  });

  it('the tree keeps its open folders when the section opens and shuts', async () => {
    shownFiles = ['a.md', 'b.md', 'c.md', 'sub/d.md'];
    disk.set(`${ROOT}/sub/d.md`, '# D\n');
    folders.add(`${ROOT}/sub`);
    await open(A);
    drawTree();
    const folderRow = document.querySelector('.sidebar-folder-toggle') as HTMLElement;
    folderRow.click();
    const tree = document.getElementById('sidebar-tree') as HTMLElement;
    tree.scrollTop = 7;
    const before = document.querySelector(
      '.sidebar-tree-children:not(.collapsed) .sidebar-file-entry',
    );
    await showLinks();
    await folder.settled();
    await showLinks();
    expect(tree.scrollTop).toBe(7);
    expect(
      document.querySelector('.sidebar-tree-children:not(.collapsed) .sidebar-file-entry'),
    ).toBe(before);
  });
});
