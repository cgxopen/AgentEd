/**
 * #79 through the flows the user actually triggers — `handleSave`,
 * `handleSaveAs`, `handleNew`, `handleNewFromTemplate` — against an
 * in-memory disk and a **real** editor, so the text that is written is
 * the text the serializer produced.
 *
 * `save-line-conventions.test.ts` pins the bytes of an unedited save.
 * These pin the four questions the bytes alone do not answer: does the
 * second save accuse the user (R-C14), does a document that was never
 * read get the default convention, does Save As carry the document's
 * conventions to the new path, and does editing the metadata panel of a
 * CRLF document write the block back as CRLF.
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

const CRLF_DOC = '---\r\ntitle: Notes\r\n---\r\n# Notes\r\n\r\nA line.\r\n';

beforeEach(() => {
  disk = new Map([['/doc/crlf.md', CRLF_DOC]]);
  dialogTitles = [];
  savePathAnswer = null;
  state = new AppState();
  clearImages();
  document.body.innerHTML = '';
});

describe('a document that was read from disk keeps its conventions', () => {
  it('writes a CRLF document back as CRLF, unedited', async () => {
    const actions = makeActions();
    await actions.openFilePath('/doc/crlf.md');
    state.setModified(true);

    await actions.handleSave();

    expect(disk.get('/doc/crlf.md')).toBe(CRLF_DOC);
  });

  it('does not raise the R-C14 dialog on a second save with no edits', async () => {
    // The test most likely to catch a mistake in *where* the baseline is
    // taken from: what is recorded as "what AgentEd believes is on disk"
    // must be the text that carries the conventions, not the assembled
    // text before they were applied.
    const stop = watchDialogs();
    const actions = makeActions();
    await actions.openFilePath('/doc/crlf.md');
    state.setModified(true);

    await actions.handleSave();
    state.setModified(true);
    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual([]);
    expect(disk.get('/doc/crlf.md')).toBe(CRLF_DOC);
  });

  it('writes the metadata block as CRLF after the panel edits it', async () => {
    // The panel hands its value through a <textarea>, which normalises
    // to `\n`; the whole assembled text is then re-imposed on save, so
    // the block comes back CRLF with nothing doubled.
    const actions = makeActions();
    await actions.openFilePath('/doc/crlf.md');
    state.frontmatter = 'title: Renamed';
    state.setModified(true);

    await actions.handleSave();

    const written = disk.get('/doc/crlf.md') ?? '';
    expect(written).toBe('---\r\ntitle: Renamed\r\n---\r\n# Notes\r\n\r\nA line.\r\n');
    expect(written).not.toContain('\r\r');
  });

  it('carries the conventions to a new path on Save As', async () => {
    // They belong to the content, not to the path — the opposite of
    // `knownDiskText`, which `requestSaveAs` clears for that very reason.
    const actions = makeActions();
    await actions.openFilePath('/doc/crlf.md');
    state.setModified(true);
    savePathAnswer = '/doc/copy.md';

    await actions.handleSaveAs();

    expect(disk.get('/doc/copy.md')).toBe(CRLF_DOC);
    expect(state.knownDiskText).toBe(CRLF_DOC);
  });
});

describe('a document that was never read is written the way markdown is written', () => {
  it('writes a new document with LF and a final newline', async () => {
    const actions = makeActions();
    await actions.handleNew();
    editor.setMarkdown('# Fresh\n\nA line.\n');
    state.setModified(true);
    savePathAnswer = '/doc/fresh.md';

    await actions.handleSaveAs();

    expect(disk.get('/doc/fresh.md')).toBe('# Fresh\n\nA line.\n');
  });

  it('writes a document seeded from a template with LF and a final newline', async () => {
    const actions = makeActions();
    await actions.handleNewFromTemplate('blank-frontmatter');
    savePathAnswer = '/doc/readme.md';

    await actions.handleSaveAs();

    const written = disk.get('/doc/readme.md') ?? '';
    expect(written).not.toContain('\r');
    expect(written.endsWith('\n')).toBe(true);
    expect(written.endsWith('\n\n')).toBe(false);
  });

  it('keeps the default even after a CRLF document was open in the session', async () => {
    // `resetDocument` puts the conventions back, so the file the user
    // had open a minute ago does not decide how a new one is written.
    const actions = makeActions();
    await actions.openFilePath('/doc/crlf.md');
    await actions.handleNew();
    editor.setMarkdown('# Fresh\n');
    state.setModified(true);
    savePathAnswer = '/doc/fresh.md';

    await actions.handleSaveAs();

    expect(disk.get('/doc/fresh.md')).toBe('# Fresh\n');
  });
});
