/**
 * #381 — what enters the recent files list, and what a file chosen from it
 * does when it is no longer on disk.
 *
 * The document actions are the real ones over a real editor, with a disk held
 * in a map, the shape `document-load-routes.test.ts` uses. The dialogs are the
 * real dialog, answered by the label a person reads, so a gate that asks is a
 * dialog that appears here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { loadRecentFiles, recordRecentFile } from '../preferences';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

const A = '/doc/a.md';
const B = '/doc/b.md';
const NEW = '/doc/new.md';

let disk: Map<string, string>;
let folders: Set<string>;
let keepsPaths: boolean;
let saveAsAnswer: string | null;

const io: PlatformIO = {
  supportsMultiFile: true,
  get pathsOutliveSession() {
    return keepsPaths;
  },
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
  pickSavePath: async () => saveAsAnswer,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: async (path: string): Promise<EntryPresence> =>
    disk.has(path) || folders.has(path) ? 'present' : 'absent',
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/** Every dialog shown, by its title, and the message of the last one. */
let dialogs: string[];
let lastMessage: string;
const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message, _error, title = 'Error') => {
    dialogs.push(title);
    lastMessage = message;
  },
};

let state: AppState;
let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;

beforeEach(() => {
  localStorage.clear();
  disk = new Map([
    [A, '# Alpha\n'],
    [B, '# Beta\n'],
  ]);
  folders = new Set(['/doc']);
  keepsPaths = true;
  saveAsAnswer = null;
  dialogs = [];
  lastMessage = '';
  clearImages();
  state = new AppState();
  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host, () => state.setModified(true));
  actions = createDocumentActions({
    state,
    reporter,
    editor: instance.editor,
    getMarkdown: instance.getMarkdown,
    setMarkdown: instance.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext);
});

afterEach(() => {
  instance.destroy();
  host.remove();
  document.querySelector('.dialog-overlay')?.remove();
});

/** The titles of the confirm dialogs the gate put on screen while `run` ran. */
async function gateQuestions(run: () => Promise<void>, answer = 'Discard'): Promise<string[]> {
  const asked: string[] = [];
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay:not([data-seen])');
    if (!overlay) return;
    overlay.setAttribute('data-seen', '');
    asked.push(overlay.querySelector('.dialog-title')?.textContent ?? '');
    const button = [...overlay.querySelectorAll('button')].find((b) => b.textContent === answer);
    button?.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await run();
  observer.disconnect();
  return asked;
}

function editTheDocument(): void {
  instance.editor.commands.insertContentAt(1, 'EDIT ');
  expect(state.modified).toBe(true);
}

describe('what enters the list (#381)', () => {
  it('takes every open that reaches a document, newest first', async () => {
    await actions.openFilePath(A);
    await actions.openFilePath(B);
    expect(loadRecentFiles()).toEqual([B, A]);
  });

  it('takes nothing on a build whose paths do not outlive the session', async () => {
    keepsPaths = false;
    await actions.openFilePath(A);
    expect(loadRecentFiles()).toEqual([]);
  });

  it('takes nothing from an open that failed', async () => {
    await actions.openFilePath('/doc/missing.md');
    expect(loadRecentFiles()).toEqual([]);
  });

  it('takes a document written under a new name by Save As', async () => {
    saveAsAnswer = NEW;
    await actions.handleSaveAs();
    expect(disk.has(NEW)).toBe(true);
    expect(loadRecentFiles()).toEqual([NEW]);
  });
});

describe('a recent file that is gone (#381)', () => {
  it('leaves the list with a sentence, before any question about unsaved changes', async () => {
    recordRecentFile(A);
    recordRecentFile('/doc/gone.md');
    await actions.openFilePath(A);
    editTheDocument();

    const asked = await gateQuestions(() => actions.openRecentFile('/doc/gone.md'));

    expect(asked).toEqual([]);
    expect(dialogs).toEqual(['This file could not be opened']);
    expect(lastMessage).toContain('taken off the recent files list');
    expect(loadRecentFiles()).toEqual([A]);
    expect(state.filePath).toBe(A);
    expect(instance.getMarkdown()).toContain('EDIT');
  });

  it('stays on the list when its folder is gone too, as a drive disconnected is', async () => {
    recordRecentFile('/away/far.md');

    await actions.openRecentFile('/away/far.md');

    expect(loadRecentFiles()).toEqual(['/away/far.md']);
    expect(lastMessage).not.toContain('taken off');
  });

  it('opens through the gate when it is there', async () => {
    await actions.openFilePath(A);
    editTheDocument();

    const asked = await gateQuestions(() => actions.openRecentFile(B));

    expect(asked).toEqual(['Unsaved changes']);
    expect(state.filePath).toBe(B);
    expect(loadRecentFiles()[0]).toBe(B);
  });
});
