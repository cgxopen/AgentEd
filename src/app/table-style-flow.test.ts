/**
 * #93 through the flows the user actually triggers — `handleSave`,
 * `handleSaveAs`, `handleNew` — against an in-memory disk and a **real**
 * editor, so the bytes written are the bytes the serializer produced.
 *
 * `src/editor/table-style.test.ts` pins what a table is written as. These pin
 * the three questions the bytes alone do not answer: does the second save
 * accuse the user of an external change (R-C14), does Save As carry the
 * spelling to the new path, and does a document the user had open a minute
 * ago decide how a new one is written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

let disk: Map<string, string>;
/** Titles of the dialogs that appeared, in order. */
let dialogTitles: string[];
/** Set per test: what the save picker answers. */
let savePathAnswer: string | null;

const io: PlatformIO = {
  supportsMultiFile: true,
  // Desktop-shaped: every path carries a directory (#46).
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (path: string) => {
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
  pickSavePath: async () => savePathAnswer,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let state: AppState;
let editor: EditorInstance;

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    throw new Error(`unexpected failure dialog: ${title}: ${message}`);
  },
};

function makeActions(): DocumentActions {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = createEditor(host);

  const ctx = {
    state,
    reporter,
    editor: editor.editor,
    getMarkdown: editor.getMarkdown,
    setMarkdown: editor.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/** Record every dialog that appears and dismiss it with Escape. */
function watchDialogs(): () => void {
  const seen = new WeakSet<Element>();
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay');
    if (!overlay || seen.has(overlay)) return;
    seen.add(overlay);
    dialogTitles.push(overlay.querySelector('.dialog-title')?.textContent ?? '');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** A file whose table is padded wider than its content needs. */
const PADDED_DOC = '# Notes\n\n| Step   | Owner  |\n| ------ | ------ |\n| One    | Ada    |\n';
/** The same content, hugged, with a tight separator — a different spelling. */
const HUGGED_DOC = '# Notes\n\n| Step | Owner |\n|------|-------|\n| One | Ada |\n';

beforeEach(() => {
  disk = new Map([
    ['/doc/padded.md', PADDED_DOC],
    ['/doc/hugged.md', HUGGED_DOC],
  ]);
  dialogTitles = [];
  savePathAnswer = null;
  state = new AppState();
  clearImages();
  document.body.innerHTML = '';
});

describe('a table is written back the way the file wrote it', () => {
  it.each([
    ['a padded table', '/doc/padded.md', PADDED_DOC],
    ['a hugged table with a tight separator', '/doc/hugged.md', HUGGED_DOC],
  ])('saves %s unedited, byte for byte', async (_label, path, original) => {
    const actions = makeActions();
    await actions.openFilePath(path);
    state.setModified(true);

    await actions.handleSave();

    expect(disk.get(path)).toBe(original);
  });

  it('does not raise the R-C14 dialog on a second save with no edits', async () => {
    // The baseline the external-change check compares against is the text
    // that was written. If the spelling were applied anywhere after that
    // point, the user would be accused of an external change on their very
    // first save — the mistake #86 made and pinned against.
    const stop = watchDialogs();
    const actions = makeActions();
    await actions.openFilePath('/doc/padded.md');
    state.setModified(true);

    await actions.handleSave();
    state.setModified(true);
    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual([]);
    expect(disk.get('/doc/padded.md')).toBe(PADDED_DOC);
  });

  it('carries the spelling to a new path on Save As', async () => {
    // It belongs to the table, not to the path.
    const actions = makeActions();
    await actions.openFilePath('/doc/padded.md');
    state.setModified(true);
    savePathAnswer = '/doc/copy.md';

    await actions.handleSaveAs();

    expect(disk.get('/doc/copy.md')).toBe(PADDED_DOC);
  });
});

describe('a document that was never read from disk', () => {
  it('writes a table the user made with hugged cells', async () => {
    const actions = makeActions();
    await actions.handleNew();
    editor.editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    state.setModified(true);
    savePathAnswer = '/doc/fresh.md';

    await actions.handleSaveAs();

    expect(disk.get('/doc/fresh.md')).toContain('| --- | --- |');
  });

  it('keeps the default after a padded document was open in the session', async () => {
    // The spelling travels with the table, so a file opened a minute ago
    // cannot decide how a new document is written — the property #86 had to
    // arrange with `resetDocument`, and which here falls out of where the
    // style lives.
    const actions = makeActions();
    await actions.openFilePath('/doc/padded.md');
    await actions.handleNew();
    editor.setMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    state.setModified(true);
    savePathAnswer = '/doc/fresh.md';

    await actions.handleSaveAs();

    expect(disk.get('/doc/fresh.md')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
  });
});
