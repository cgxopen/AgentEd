import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { HELP_TITLES, helpMarkdown } from '../help/index';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

/**
 * A window opened for a help (#701): the help under its name, not marked,
 * an ordinary document from the first edit on.
 */

let disk: Map<string, string>;
let savePathAnswer: string | null;
let shownName: string | null;

const io: PlatformIO = {
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (path: string) => disk.get(path) ?? '',
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
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    throw new Error(`unexpected failure dialog: ${title}: ${message}`);
  },
};

let editor: EditorInstance | null = null;

beforeEach(() => {
  disk = new Map();
  savePathAnswer = null;
  shownName = null;
  clearImages();
  document.body.innerHTML = '';
  vi.mocked(showConfirmDialog).mockReset();
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeActions(state: AppState): DocumentActions {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = createEditor(host);
  state.readEditorDocument = () => (editor as EditorInstance).editor.state.doc;
  const ctx = {
    state,
    reporter,
    editor: editor.editor,
    getMarkdown: editor.getMarkdown,
    setMarkdown: editor.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: (name: string | null) => {
      shownName = name;
    },
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: vi.fn(), setVisible: vi.fn(), reveal: vi.fn() },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/** Type at the start, then ask for the mark as the editor update does in `main.ts`. */
function type(state: AppState, text: string): void {
  const { view } = (editor as EditorInstance).editor;
  view.dispatch(view.state.tr.insertText(text, 1));
  state.refreshModified();
}

describe('a help opened in its window (#701)', () => {
  it.each([
    ['shortcuts', 'Keyboard Shortcuts'],
    ['guide', 'User Guide'],
  ] as const)('%s: its text, under its name, not marked', (id, name) => {
    const state = new AppState();
    const actions = makeActions(state);
    actions.openHelp(id);
    expect(HELP_TITLES[id]).toBe(name);
    expect(shownName).toBe(name);
    expect(state.untitledName).toBe(name);
    expect(state.filePath).toBeNull();
    expect(state.modified).toBe(false);
    expect((editor as EditorInstance).getMarkdown()).toBe(helpMarkdown(id).replace(/\n$/, ''));
  });

  it('closes with no question while nothing in it is edited', async () => {
    const state = new AppState();
    const actions = makeActions(state);
    actions.openHelp('shortcuts');
    expect(await actions.confirmWindowClose()).toBe(true);
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });

  it('an edit marks it, and the unsaved-changes question names it', async () => {
    const state = new AppState();
    const actions = makeActions(state);
    actions.openHelp('guide');
    type(state, 'X');
    expect(state.modified).toBe(true);
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    expect(await actions.confirmWindowClose()).toBe(false);
    const asked = vi.mocked(showConfirmDialog).mock.calls[0][0];
    expect(asked.message).toBe(
      'User Guide has unsaved changes.\nWhat do you want to do before closing the window?',
    );
  });

  it('Save asks where, and writes the edited help there', async () => {
    const state = new AppState();
    const actions = makeActions(state);
    actions.openHelp('shortcuts');
    type(state, 'X');
    savePathAnswer = '/doc/keys.md';
    await actions.handleSave();
    expect(disk.get('/doc/keys.md')?.startsWith('# XKeyboard Shortcuts\n')).toBe(true);
    expect(state.filePath).toBe('/doc/keys.md');
    expect(state.modified).toBe(false);
  });

  it('Save with nothing chosen writes nothing and keeps it marked', async () => {
    const state = new AppState();
    const actions = makeActions(state);
    actions.openHelp('shortcuts');
    type(state, 'X');
    await actions.handleSave();
    expect(disk.size).toBe(0);
    expect(state.modified).toBe(true);
  });

  it('New gives the window an Untitled document and forgets the name of the help', async () => {
    const state = new AppState();
    const actions = makeActions(state);
    actions.openHelp('guide');
    await actions.handleNew();
    expect(state.untitledName).toBeNull();
    expect(shownName).toBeNull();
  });
});
