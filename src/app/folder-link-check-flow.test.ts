/**
 * #766 - the check of the links of every markdown file in the folder the files
 * panel shows, started by hand. Over a real editor, the panel mounted from the
 * shipped page, the «Links» badge and list of #729, and the document actions
 * with a disk held in a map, wired as `main.ts` wires them.
 */
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { parseDocument } from '../editor/document-load';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type {
  EntryPresence,
  FileEntry,
  FileSnapshot,
  MarkdownTree,
  PlatformIO,
} from '../platform/types';
import { shippedElement } from '../test-support/shipped-markup';
import { setupDocumentBadges } from '../ui/document-badges';
import {
  FILE_TOO_LARGE_LINE,
  FILE_UNREAD_LINE,
  FOLDER_CHECK_AGAIN,
  FOLDER_CHECK_CLEAR,
  FOLDER_CHECK_DOOR,
  FOLDER_CHECK_RING_CLASS,
  FOLDER_CHECK_STOP,
  FOLDER_RENAMED_LINE,
  onlyFirstFilesLine,
  runningText,
  startedText,
  stoppedLine,
} from '../ui/links-folder-report';
import {
  brokenLinkLine,
  LINKS_NOT_CHECKED_HEADING,
  NOT_CHECKED_LINES,
  setupLinksPopover,
  WEB_ADDRESS_HOW,
} from '../ui/links-popover';
import { buildTree, type Sidebar, setupSidebar } from '../ui/sidebar';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { MAX_FILE_BYTES, MAX_FOLDER_FILES, MAX_FOLDER_LINKS } from './folder-link-check';
import { createFolderLinkReport, type FolderLinkReport } from './folder-link-report';
import { collectLinks, MAX_CHECKED_LINKS } from './link-check';
import {
  checkOnArrival,
  createLinksReport,
  LINK_GONE_MESSAGE,
  type LinksReport,
} from './links-report';
import { followRelativeLink } from './relative-link';
import { openSidebarByHand } from './sidebar-sync';
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
const status = () => document.getElementById('sidebar-links-status')?.textContent ?? '';

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(slot()?.querySelectorAll('button') ?? []).find((b) => b.textContent === text);
}

async function check(): Promise<void> {
  const door = button(FOLDER_CHECK_DOOR) ?? button(FOLDER_CHECK_AGAIN);
  if (!door) throw new Error('no door to press');
  door.click();
  await folder.settled();
}

/** The rows of files, as name and count. */
function fileRows(): Array<[string, string]> {
  return Array.from(
    slot()?.querySelectorAll('.links-folder-file:not(.links-folder-apart)') ?? [],
  ).map((r) => [
    r.querySelector('.links-folder-name')?.textContent ?? '',
    r.querySelector('.links-folder-count')?.textContent ?? '',
  ]);
}

function openRow(name: string): void {
  const row = Array.from(slot()?.querySelectorAll<HTMLElement>('.links-folder-file') ?? []).find(
    (r) => r.querySelector('.links-folder-name')?.textContent === name,
  );
  if (!row) throw new Error(`no row ${name}`);
  row.click();
}

/** The link rows drawn, as address and line. */
function linkRows(): Array<[string, string]> {
  return Array.from(slot()?.querySelectorAll('.links-row') ?? []).map((r) => [
    r.querySelector('.links-row-address')?.textContent ?? '',
    r.querySelector('.links-row-line')?.textContent ?? '',
  ]);
}

const notes = () =>
  Array.from(slot()?.querySelectorAll('.links-folder-note') ?? []).map((n) => n.textContent);
const counts = () => slot()?.querySelector('.links-folder-counts')?.textContent;
const badge = () => document.getElementById('badge-links') as HTMLElement;

function setHref(from: string, to: string): void {
  const s = instance.editor.state;
  const link = collectLinks(s.doc).find((l) => l.href === from);
  if (!link) throw new Error(`no link ${from}`);
  const type = s.schema.marks.link;
  instance.editor.view.dispatch(
    s.tr
      .removeMark(link.from, link.to, type)
      .addMark(link.from, link.to, type.create({ href: to })),
  );
}

function writeLink(text: string, href: string): void {
  const s = instance.editor.state;
  const type = s.schema.marks.link;
  instance.editor.view.dispatch(
    s.tr.insertText(text, 1).addMark(1, 1 + text.length, type.create({ href })),
  );
}

describe('the report names the broken links of the folder (#766)', () => {
  it('row 1: of three files, the one holding a broken link is named with that link, and no other', async () => {
    drawTree();
    await check();
    expect(counts()).toBe('1 broken link in 1 of 3 files');
    expect(fileRows()).toEqual([['a.md', '1']]);
    openRow('a.md');
    expect(linkRows()).toEqual([['gone.md', brokenLinkLine('/notes/docs/gone.md')]]);
  });

  it('row 2: a link written as an a element with href, in a file that is not open, is found', async () => {
    disk.set(B, '# Beta\n\nSee <a href="missing.md">the old page</a>.\n');
    drawTree();
    await check();
    expect(fileRows()).toEqual([
      ['a.md', '1'],
      ['b.md', '1'],
    ]);
    openRow('b.md');
    expect(linkRows()).toEqual([['missing.md', brokenLinkLine('/notes/docs/missing.md')]]);
  });

  it('row 3: a web address, a link to a heading alone and an address starting with a slash are never broken', async () => {
    disk.set(A, '[web](https://example.com/gone.md) [heading](#gone) [rooted](/gone.md)\n');
    drawTree();
    await check();
    expect(counts()).toBe('No broken links in 3 files');
    expect(notes()).toEqual(['2 could not be checked']);
    expect(fileRows()).toEqual([]);
    openRow(LINKS_NOT_CHECKED_HEADING);
    expect(linkRows()).toEqual([
      ['#gone', NOT_CHECKED_LINES['anchor-only']],
      ['/gone.md', NOT_CHECKED_LINES.rooted],
    ]);
  });

  it('nothing is written: the disk holds what it held', async () => {
    const before = new Map(disk);
    drawTree();
    await check();
    expect(disk).toEqual(before);
  });
});

describe('the open file is read from the editor, never from the disk (#766)', () => {
  it('row 4: an unsaved edit that repairs a link drops it, and one that writes a broken link adds it', async () => {
    await open(A);
    setHref('gone.md', 'b.md');
    reads.length = 0;
    await check();
    expect(reads).not.toContain(A);
    expect(fileRows()).toEqual([]);
    writeLink('new ', 'missing.md');
    await check();
    expect(fileRows()).toEqual([['a.md', '1']]);
    openRow('a.md');
    expect(linkRows()).toEqual([['missing.md', brokenLinkLine('/notes/docs/missing.md')]]);
  });

  it('route A on the other files changes nothing in the editor: document, selection and history stay', async () => {
    await open(A);
    writeLink('x', 'b.md');
    const doc = instance.editor.state.doc;
    const selection = instance.editor.state.selection;
    const depth = undoDepth(instance.editor.state);
    await check();
    expect(instance.editor.state.doc).toBe(doc);
    expect(instance.editor.state.selection.eq(selection)).toBe(true);
    expect(undoDepth(instance.editor.state)).toBe(depth);
  });

  it('row 5: after a save of the open file its row agrees with the Links badge, with no Check again', async () => {
    await open(A);
    await check();
    expect(fileRows()).toEqual([['a.md', '1']]);
    expect(badge().textContent).toContain('1');
    writeLink('two ', 'missing.md');
    await actions.handleSave();
    await Promise.all(runs);
    expect(fileRows()).toEqual([['a.md', '2']]);
    expect(badge().textContent).toContain('2');
    setHref('gone.md', 'b.md');
    setHref('missing.md', 'c.md');
    await actions.handleSave();
    await Promise.all(runs);
    expect(fileRows()).toEqual([]);
    expect(badge().style.display).toBe('none');
  });

  it('a save with a report shown writes the bytes a save without one writes (R-C2)', async () => {
    await open(A);
    writeLink('x', 'b.md');
    await actions.handleSave();
    const without = disk.get(A);
    disk.set(A, '# Alpha\n\n[good](b.md) and [gone](gone.md)\n');
    await open(A);
    writeLink('x', 'b.md');
    await check();
    await actions.handleSave();
    expect(disk.get(A)).toBe(without);
  });
});

describe('the four bounds, each with its sentence (#766)', () => {
  it('row 6, files: one file past 2000, and the report says only the first 2000 were checked', {
    timeout: 120_000,
  }, async () => {
    const files = Array.from({ length: MAX_FOLDER_FILES + 1 }, (_, i) => `f${i}.md`);
    for (const f of files) disk.set(`${ROOT}/${f}`, '');
    drawTree(ROOT, files);
    await check();
    expect(MAX_FOLDER_FILES).toBe(2000);
    expect(notes()).toEqual([onlyFirstFilesLine(2000)]);
    // Empty files hold no link to check (#792, owner decision of 2026-11-24).
    expect(counts()).toBe('No links to check in 2000 files');
    expect(reads).not.toContain(`${ROOT}/f2000.md`);
  });

  it('row 6, links of a file: one link past 5000 is not checked, with the sentence of #729', {
    timeout: 120_000,
  }, async () => {
    expect(MAX_CHECKED_LINKS).toBe(5000);
    disk.set(B, `${'[l](a.md) '.repeat(MAX_CHECKED_LINKS + 1)}\n`);
    drawTree();
    await check();
    openRow(LINKS_NOT_CHECKED_HEADING);
    expect(linkRows()).toEqual([['a.md', NOT_CHECKED_LINES['too-many']]]);
  });

  it('row 6, links of a check: the check reads no file once 20000 relative links are found, and says so', {
    timeout: 300_000,
  }, async () => {
    expect(MAX_FOLDER_LINKS).toBe(20000);
    const many = `${'[l](a.md) '.repeat(4000)}\n`;
    const files = ['f0.md', 'f1.md', 'f2.md', 'f3.md', 'f4.md', 'f5.md'];
    for (const f of files.slice(0, 5)) disk.set(`${ROOT}/${f}`, many);
    disk.set(`${ROOT}/f5.md`, '[last](gone.md)\n');
    disk.set(`${ROOT}/a.md`, '# Alpha\n');
    drawTree(ROOT, [...files, 'a.md']);
    await check();
    expect(reads).not.toContain(`${ROOT}/f5.md`);
    expect(notes()).toEqual([onlyFirstFilesLine(5)]);
    // One link fewer, and the next file is read.
    disk.set(`${ROOT}/f4.md`, `${'[l](a.md) '.repeat(3999)}\n`);
    reads.length = 0;
    await check();
    expect(reads).toContain(`${ROOT}/f5.md`);
    expect(fileRows()).toEqual([['f5.md', '1']]);
  });

  it('row 6, bytes: a file one byte past 512 KB is under Not checked and never parsed; one at 512 KB is read', {
    timeout: 120_000,
  }, async () => {
    expect(MAX_FILE_BYTES).toBe(512_000);
    disk.set(B, `[gone](gone.md)${'a'.repeat(MAX_FILE_BYTES - 15)}`);
    disk.set(C, `[gone](gone.md)${'a'.repeat(MAX_FILE_BYTES - 14)}`);
    drawTree();
    await check();
    const parsed = vi.mocked(parseDocument).mock.calls.map(([, md]) => md.length);
    expect(parsed).toContain(MAX_FILE_BYTES);
    expect(parsed).not.toContain(MAX_FILE_BYTES + 1);
    expect(fileRows()).toEqual([
      ['a.md', '1'],
      ['b.md', '1'],
    ]);
    openRow(LINKS_NOT_CHECKED_HEADING);
    const lines = Array.from(slot()?.querySelectorAll('.links-folder-links li') ?? []).map(
      (l) => l.textContent,
    );
    expect(lines).toEqual(['c.md', FILE_TOO_LARGE_LINE]);
  });
});

describe('what is not read is not checked, never broken (#766)', () => {
  it('row 7: a file that cannot be read is under Not checked, and nothing in it is called broken', async () => {
    disk.set(B, '[gone](gone.md)\n');
    unreadable.add(B);
    drawTree();
    await check();
    expect(fileRows()).toEqual([['a.md', '1']]);
    openRow(LINKS_NOT_CHECKED_HEADING);
    const lines = Array.from(slot()?.querySelectorAll('.links-folder-links li') ?? []).map(
      (l) => l.textContent,
    );
    expect(lines).toEqual(['b.md', FILE_UNREAD_LINE]);
  });
});

describe('a check running, stopped, and left behind (#766)', () => {
  function gate(path: string): () => void {
    let release!: () => void;
    readGate = { path, open: new Promise<void>((r) => (release = r)) };
    return release;
  }

  it('row 14: the running line holds the ring, hidden from a screen reader, and the count', async () => {
    const release = gate(B);
    drawTree();
    button(FOLDER_CHECK_DOOR)?.click();
    await vi.waitFor(() => expect(reads).toContain(B));
    const ring = slot()?.querySelector(`.${FOLDER_CHECK_RING_CLASS}`);
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    expect(slot()?.querySelector('.links-folder-count-text')?.textContent).toBe(runningText(1, 3));
    expect(status()).toBe(startedText(3));
    release();
    await folder.settled();
    expect(slot()?.querySelector(`.${FOLDER_CHECK_RING_CLASS}`)).toBeNull();
    expect(status()).toBe('1 broken link in 1 of 3 files');
  });

  it('row 8: Stop ends the work within the file in progress, and the report shows what was read', async () => {
    const release = gate(B);
    drawTree();
    button(FOLDER_CHECK_DOOR)?.click();
    await vi.waitFor(() => expect(reads).toContain(B));
    button(FOLDER_CHECK_STOP)?.click();
    release();
    await folder.settled();
    expect(reads).not.toContain(C);
    expect(notes()).toEqual([stoppedLine(2, 3)]);
    expect(counts()).toBe('1 broken link in 1 of 2 files');
    expect(slot()?.querySelector(`.${FOLDER_CHECK_RING_CLASS}`)).toBeNull();
    expect(document.activeElement?.textContent).toBe(FOLDER_CHECK_AGAIN);
  });

  it('row 9: the panel closed during a check stops it, and opened again it shows the door and no report', async () => {
    const release = gate(B);
    drawTree();
    button(FOLDER_CHECK_DOOR)?.click();
    await vi.waitFor(() => expect(reads).toContain(B));
    sidebar.hide();
    release();
    await folder.settled();
    expect(reads).not.toContain(C);
    drawTree();
    expect(button(FOLDER_CHECK_DOOR)).toBeDefined();
    expect(slot()?.querySelector('.links-folder-report')).toBeNull();
  });

  it('row 10: the panel showing another folder clears the report', async () => {
    drawTree();
    await check();
    expect(slot()?.querySelector('.links-folder-report')).not.toBeNull();
    drawTree('/elsewhere', ['x.md']);
    expect(slot()?.querySelector('.links-folder-report')).toBeNull();
    expect(button(FOLDER_CHECK_DOOR)).toBeDefined();
  });

  it('a redraw of the same folder keeps the report, as a save or a switch within it does', async () => {
    drawTree();
    await check();
    drawTree();
    expect(fileRows()).toEqual([['a.md', '1']]);
  });

  it('Clear takes the report away and puts the focus on the door', async () => {
    drawTree();
    await check();
    button(FOLDER_CHECK_CLEAR)?.click();
    expect(slot()?.querySelector('.links-folder-report')).toBeNull();
    expect(document.activeElement?.textContent).toBe(FOLDER_CHECK_DOOR);
  });

  it('the renamed open file keeps its row, and the report says a file was renamed', async () => {
    await open(A);
    await check();
    folder.renamed(A, `${ROOT}/alpha.md`);
    expect(fileRows()).toEqual([['alpha.md', '1']]);
    expect(notes()).toEqual([FOLDER_RENAMED_LINE]);
  });
});

describe('the jump (#766)', () => {
  it('row 11: with unsaved changes the jump passes through the question; Cancel changes nothing and the report stays', async () => {
    disk.set(B, '# Beta\n\n[lost](lost.md)\n');
    await open(A);
    writeLink('edit ', 'b.md');
    expect(state.modified).toBe(true);
    const doc = instance.editor.state.doc;
    drawTree();
    await check();
    openRow('b.md');
    showConfirmDialog.mockResolvedValue('cancel');
    (slot()?.querySelector('.links-row') as HTMLElement | null)?.click();
    await vi.waitFor(() => expect(showConfirmDialog).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(state.filePath).toBe(A);
    expect(jumped).toEqual([]);
    expect(instance.editor.state.doc).toBe(doc);
    expect(fileRows()).toEqual([
      ['a.md', '1'],
      ['b.md', '1'],
    ]);
  });

  it('Discard at the question opens the file with the link selected', async () => {
    disk.set(B, '# Beta\n\nText [lost](lost.md) here\n');
    await open(A);
    writeLink('edit ', 'b.md');
    drawTree();
    await check();
    openRow('b.md');
    showConfirmDialog.mockResolvedValue('discard');
    (
      Array.from(slot()?.querySelectorAll<HTMLElement>('.links-row') ?? []).find((r) =>
        r.textContent?.startsWith('lost.md'),
      ) as HTMLElement
    ).click();
    // Read at the moment of the jump, as the tests of #729 read it: happy-dom
    // draws no selection, and its own selection read afterwards can move the
    // caret back. That the link stays selected on screen is the manual pass.
    await vi.waitFor(() => expect(jumped).toEqual(['lost']));
    expect(state.filePath).toBe(B);
  });

  it('row 12: a link no longer in the file is told with the line of #729, and the file stays open', async () => {
    disk.set(B, '# Beta\n\n[lost](lost.md)\n');
    drawTree();
    await check();
    disk.set(B, '# Beta\n\nThe link went away.\n');
    openRow('b.md');
    (slot()?.querySelector('.links-row') as HTMLElement | null)?.click();
    await vi.waitFor(() => expect(toasts).toContain(LINK_GONE_MESSAGE));
    expect(state.filePath).toBe(B);
  });
});

describe('the links that could not be checked are counted on a line of their own (#779, #781)', () => {
  const shut = () =>
    Array.from(slot()?.querySelectorAll('.links-folder-apart .links-folder-count') ?? []).map(
      (c) => c.textContent,
    );

  it('row 3 of #781: nothing broken and three such links: the first line as before, then 3 could not be checked', async () => {
    disk.set(A, '[one](/x.md) [two](/y.md) [three](#h)\n');
    drawTree();
    await check();
    expect(counts()).toBe('No broken links in 3 files');
    expect(notes()).toEqual(['3 could not be checked']);
    expect(shut()).toEqual(['3']);
  });

  it('row 4 of #781: broken links and such links, both counts in the new words', async () => {
    disk.set(A, '[gone](gone.md) [rooted](/x.md)\n');
    drawTree();
    await check();
    expect(counts()).toBe('1 broken link in 1 of 3 files');
    expect(notes()).toEqual(['1 could not be checked']);
  });

  it('row 5 of #781: with no such link, the head of the report as on main', async () => {
    drawTree();
    await check();
    expect(counts()).toBe('1 broken link in 1 of 3 files');
    expect(notes()).toEqual([]);
    expect(shut()).toEqual([]);
  });

  it('a file skipped whole counts as one, as in the shut row (#779)', async () => {
    disk.set(A, '# Alpha\n');
    unreadable.add(B);
    disk.set(C, 'a'.repeat(MAX_FILE_BYTES + 1));
    drawTree();
    await check();
    expect(notes()).toEqual(['2 could not be checked']);
    expect(shut()).toEqual(['2']);
  });

  it('row 6 of #781: the status line at the end says the lines of the head', async () => {
    disk.set(A, '[gone](gone.md) [rooted](/x.md)\n');
    drawTree();
    await check();
    expect(status()).toBe(`${counts()}. ${notes()[0]}`);
    expect(status()).toBe('1 broken link in 1 of 3 files. 1 could not be checked');
  });

  it('after the row of the open file is refreshed by the check of #729, the line and the shut row agree (#779)', async () => {
    disk.set(A, '# Alpha\n\n[rooted](/x.md)\n');
    await open(A);
    await check();
    expect(notes()).toEqual(['1 could not be checked']);
    writeLink('more ', '/y.md');
    await actions.handleSave();
    await Promise.all(runs);
    expect(notes()).toEqual(['2 could not be checked']);
    expect(shut()).toEqual(['2']);
  });
});

describe('the door, only where a markdown tree is drawn (#766)', () => {
  it('row 13: the offer, No related files or folders and This folder could not be read draw no door', () => {
    for (const draw of [
      () => sidebar.showAccessOffer(),
      () => sidebar.showNothingRelated(),
      () => sidebar.showUnreadable(),
    ]) {
      drawTree();
      expect(button(FOLDER_CHECK_DOOR)).toBeDefined();
      draw();
      expect(document.querySelector('.links-folder-line')).toBeNull();
    }
  });

  it('a tree that is not a markdown tree, a folder listing or the web build, draws no door', () => {
    sidebar.showTree(
      buildTree([{ path: 'a.png', kind: 'file' }]),
      'assets',
      `${ROOT}/assets`,
      false,
    );
    expect(document.querySelector('.links-folder-line')).toBeNull();
    expect(slot()).toBeNull();
  });

  it('the panel opened by hand on a markdown tree draws the door, from the files of the walk', async () => {
    state.filePath = A;
    const withTree = {
      ...io,
      markdownTree: async (): Promise<MarkdownTree> => ({
        files: ['a.md', 'b.md', 'assets/x.png'],
        reachedBound: false,
      }),
    } as PlatformIO;
    let pending: Promise<void> = Promise.resolve();
    sidebar.setOnOpenByHand((ticket) => {
      pending = openSidebarByHand(state, sidebar, withTree, ticket);
    });
    sidebar.toggle();
    await pending;
    expect(button(FOLDER_CHECK_DOOR)).toBeDefined();
    await check();
    // The image of the assets folder is not a markdown file, and is not read;
    // the open file is read from the editor, empty here, and not from the disk.
    expect(reads).toEqual([B]);
    expect(counts()).toBe('No broken links in 2 files');
  });
});

/**
 * #792 - the report says when there was nothing to check, and a link with the
 * shape of a web address that leads nowhere says how a web address is written
 * (owner decisions of 2026-11-24). The routes are the real ones of this file:
 * the folder check and its report, the list of the open document, and the
 * Ctrl+click of `relative-link.ts`.
 */
describe('nothing to check, and a web address without its scheme (#792)', () => {
  const HOW = WEB_ADDRESS_HOW;
  const couldNot = () => notes().filter((n) => n?.endsWith('could not be checked'));

  it('row 1: three files with no link to another file: No links to check in 3 files', async () => {
    disk.set(A, '# Alpha\n\nNo link here.\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe('No links to check in 3 files');
  });

  it('row 2: the same with one good link: No broken links in 3 files', async () => {
    disk.set(A, '# Alpha\n\n[beta](b.md)\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe('No broken links in 3 files');
  });

  it('row 3: with only links that could not be checked: No broken links, and their count under it', async () => {
    disk.set(A, '# Alpha\n\n[rooted](/r.md) and [heading](#h)\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe('No broken links in 3 files');
    expect(couldNot()).toEqual(['2 could not be checked']);
  });

  it('row 3: a file that could not be read may hold links: No broken links, and its count under it', async () => {
    disk.set(A, '# Alpha\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '# Gamma\n');
    unreadable.add(C);
    drawTree();
    await check();
    expect(counts()).toBe('No broken links in 3 files');
    expect(couldNot()).toEqual(['1 could not be checked']);
  });

  it('a link of the shape not checked for another reason keeps the sentence of today', async () => {
    state.filePath = null;
    instance.setMarkdown('[w](www.example.com)');
    await linksReport.run();
    badge().click();
    const lines = Array.from(document.querySelectorAll('#links-popover .links-row-line')).map(
      (l) => l.textContent,
    );
    expect(lines).toEqual([NOT_CHECKED_LINES['no-document']]);
  });

  it('row 4: with web addresses alone, written with their scheme: No links to check', async () => {
    disk.set(A, '# Alpha\n\n[site](https://www.example.com) and [mail](mailto:a@example.com)\n');
    disk.set(B, '# Beta\n\n<https://example.org/page>\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe('No links to check in 3 files');
  });

  it('row 5: the status line at the end of a check says the same first line', async () => {
    disk.set(A, '# Alpha\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(status()).toBe('No links to check in 3 files');
  });

  it('rows 6, 7 and 11: www.example.com and example.com/page, not found: counted as broken, and the line ends with the sentence, by one constant', async () => {
    disk.set(A, '# Alpha\n\n[w](www.example.com) and [p](example.com/page)\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe('2 broken links in 1 of 3 files');
    openRow('a.md');
    expect(linkRows()).toEqual([
      ['www.example.com', `www.example.com was not found. ${HOW}`],
      ['example.com/page', `page was not found. ${HOW}`],
    ]);
    expect(HOW).toBe(
      'If this is a web address, write it with https:// in front, such as https://www.example.com.',
    );
  });

  it('rows 6 and 7: in the list of the open document, the same line', async () => {
    disk.set(A, '# Alpha\n\n[w](www.example.com) and [p](example.com/page)\n');
    await open(A);
    expect(badge().textContent).toContain('2');
    badge().click();
    const rows = Array.from(document.querySelectorAll('#links-popover .links-row')).map((r) => [
      r.querySelector('.links-row-address')?.textContent,
      r.querySelector('.links-row-line')?.textContent,
    ]);
    expect(rows).toEqual([
      ['www.example.com', `www.example.com was not found. ${HOW}`],
      ['example.com/page', `page was not found. ${HOW}`],
    ]);
  });

  it('row 7: example.org/ names a folder, so it is not checked and not counted as broken; its line says how too', async () => {
    disk.set(A, '# Alpha\n\n[o](example.org/) and [g](www.gnu.org/software/bash/)\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe('No broken links in 3 files');
    expect(couldNot()).toEqual(['2 could not be checked']);
    openRow(LINKS_NOT_CHECKED_HEADING);
    expect(linkRows()).toEqual([
      ['example.org/', `${NOT_CHECKED_LINES.folder} ${HOW}`],
      ['www.gnu.org/software/bash/', `${NOT_CHECKED_LINES.folder} ${HOW}`],
    ]);
  });

  it('row 8: each of these, not found, says only what it says today', async () => {
    const addresses = [
      './a.b/c',
      '../docs/a.b/c',
      '.github/x',
      'v1.2/notes.md',
      '2024.11/x',
      'notes.com',
      'readme.md',
      'docs.old',
    ];
    disk.set(A, `# Alpha\n\n${addresses.map((a, i) => `[l${i}](${a})`).join(' ')}\n`);
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe(`${addresses.length} broken links in 1 of 3 files`);
    openRow('a.md');
    for (const [address, line] of linkRows()) {
      expect(line, address).not.toContain(HOW);
      expect(line, address).toMatch(/ was not found\.$/);
    }
  });

  it('row 8: a folder named by an address with no web shape keeps the sentence of today', async () => {
    disk.set(A, '# Alpha\n\n[f](v1.2/)\n');
    disk.set(B, '# Beta\n');
    disk.set(C, '');
    drawTree();
    await check();
    openRow(LINKS_NOT_CHECKED_HEADING);
    expect(linkRows()).toEqual([['v1.2/', NOT_CHECKED_LINES.folder]]);
  });

  it('row 9: node.js/readme.md found says nothing; not found, the sentence is there, the cost the owner accepted', async () => {
    folders.add(`${ROOT}/node.js`);
    disk.set(`${ROOT}/node.js/readme.md`, '# Node\n');
    disk.set(A, '# Alpha\n\n[n](node.js/readme.md)\n');
    disk.set(B, '# Beta\n\n[m](node.js/missing.md)\n');
    disk.set(C, '');
    drawTree();
    await check();
    expect(counts()).toBe('1 broken link in 1 of 3 files');
    expect(fileRows()).toEqual([['b.md', '1']]);
    openRow('b.md');
    expect(linkRows()).toEqual([['node.js/missing.md', `missing.md was not found. ${HOW}`]]);
  });

  it('row 12: no address is rewritten: the markdown of the document is byte for byte what it was', async () => {
    const text =
      '# Alpha\n\n[w](www.example.com) and [p](example.com/page) and [o](example.org/)\n';
    disk.set(A, text);
    await open(A);
    const before = instance.getMarkdown();
    expect(before).toContain(
      '[w](www.example.com) and [p](example.com/page) and [o](example.org/)',
    );
    drawTree();
    await check();
    badge().click();
    await followRelativeLink(
      {
        documentPath: () => A,
        panelRoot: () => null,
        io: async () => io,
        openFilePath: async () => {},
        tell: () => {},
      },
      'www.example.com',
    );
    const hrefs = collectLinks(instance.editor.state.doc).map((l) => l.href);
    expect(hrefs).toEqual(['www.example.com', 'example.com/page', 'example.org/']);
    expect(instance.getMarkdown()).toBe(before);
  });
});

describe('Ctrl and a click on a web address without its scheme (#792)', () => {
  const told: string[] = [];
  const HOW = WEB_ADDRESS_HOW;

  function deps(presence?: (path: string) => EntryPresence) {
    told.length = 0;
    const clickIO = {
      ...io,
      opensFilesWithSystem: true,
      entryPresence: async (path: string): Promise<EntryPresence> =>
        presence ? presence(path) : disk.has(path) || folders.has(path) ? 'present' : 'absent',
    } as unknown as PlatformIO;
    return {
      documentPath: () => A,
      panelRoot: () => null,
      io: async () => clickIO,
      openFilePath: vi.fn(async () => {}),
      tell: (message: string) => told.push(message),
    };
  }

  it('row 10: www.example.com and example.com/page, absent: was not found, followed by the sentence of how', async () => {
    await followRelativeLink(deps(), 'www.example.com');
    await followRelativeLink(deps(), 'example.com/page');
    expect(told).toEqual([`page was not found. ${HOW}`]);
    await followRelativeLink(deps(), 'www.example.com');
    expect(told).toEqual([`www.example.com was not found. ${HOW}`]);
  });

  it('row 10: a folder AgentEd could not look in: the sentence of today for it, and the sentence of how', async () => {
    await followRelativeLink(
      deps(() => 'unknown'),
      'www.example.com',
    );
    expect(told).toEqual([
      `AgentEd could not look in the folder of www.example.com, so it is not opened. ${HOW}`,
    ]);
  });

  it('row 10: example.org/ names a folder: the sentence of today, and the sentence of how', async () => {
    await followRelativeLink(deps(), 'example.org/');
    expect(told).toEqual([`This link names a folder; AgentEd opens markdown files. ${HOW}`]);
  });

  it('row 10: a markdown file of the shape, absent: was not found and how', async () => {
    await followRelativeLink(deps(), 'example.com/page.md');
    expect(told).toEqual([`page.md was not found. ${HOW}`]);
  });

  it('a file of the shape that is there goes to the system as before, and says only what it said', async () => {
    disk.set(`${ROOT}/www.example.com`, '');
    await followRelativeLink(deps(), 'www.example.com');
    expect(told).toEqual(['Could not open www.example.com.']);
  });

  it('a link of another kind of file that is found opens with the system as today', async () => {
    disk.set(`${ROOT}/picture.png`, '');
    const d = deps();
    await followRelativeLink(d, 'picture.png');
    expect(io.openWithSystem).toHaveBeenCalled();
    expect(told).toEqual(['Opening picture.png with the system viewer…']);
  });

  it('an address with no web shape says only what it said: missing.md, notes.com', async () => {
    await followRelativeLink(deps(), 'missing.md');
    expect(told).toEqual(['missing.md was not found.']);
    await followRelativeLink(deps(), 'notes.com');
    expect(told).toEqual(['Could not open notes.com.']);
  });
});
