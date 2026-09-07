/**
 * A save that fails for any reason but `NO_DIR_HANDLE` (#171).
 *
 * Nothing exercised this before: two tests covered the *assets* phase
 * failing, none covered the document write itself. Measured on `main` at
 * `9526cbe`, a throw from `io.saveFile` reached `main.ts:200` and stopped
 * in `.catch(console.error)` — no dialog, no statusbar note, and no
 * console on a shipped build, which has no `devtools` feature.
 *
 * **The two halves are both load-bearing, and neither implies the other.**
 * A fix that is too broad satisfies the failing half and breaks the
 * working one, and a dialog on every save is a worse product than silence
 * on a failed one.
 *
 * The reporter here is the **real** one, and the dialog is read at
 * `showConfirmDialog`, where it is actually assembled — the #127
 * discipline. A fake that records its first argument would assert half of
 * what the user reads, and the half it drops is exactly the half this
 * change is about.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import type { FileEntry, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { showToast } from '../ui/toast';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import { createErrorReporter } from './error-reporter';
import { SAVE_FAILED_TITLE, saveFailedMessage, saveFailureCause } from './save-failure';
import { AppState } from './state';

/**
 * The exact string the desktop platform produces, assembled from two
 * measurements: the scaffold, read out of `tauri-plugin-fs` 2.4.5
 * (`commands.rs`, both the open and the write branch), and the tail,
 * measured on the owner's Windows for the codes this path reaches.
 */
const WINDOWS_LOCKED =
  'failed to open file at path: C:\\Users\\user\\Downloads\\notes.md with error: ' +
  'The process cannot access the file because it is being used by another process. (os error 32)';
const WINDOWS_READONLY =
  'failed to open file at path: C:\\Users\\user\\Downloads\\notes.md with error: ' +
  'Access is denied. (os error 5)';

/** Set per test: what the document write should do. */
let saveFileThrows: Error | null = null;
let pickedPath: string | null = null;
let written: Array<{ path: string; text: string }> = [];

const io: PlatformIO = {
  supportsMultiFile: true,
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async () => '',
  saveFile: async (path: string, text: string) => {
    if (saveFileThrows) throw saveFileThrows;
    written.push({ path, text });
  },
  pickSavePath: async () => pickedPath,
  readSnapshot: async () => ({ kind: 'absent' as const }),
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

const reporter = createErrorReporter();

/** Every dialog raised, as the user would read it: title, then body. */
function dialogsRaised(): Array<{ title: string; message: string }> {
  return vi.mocked(showConfirmDialog).mock.calls.map((call) => {
    const options = call[0] as { title?: string; message: string };
    return { title: options.title ?? '', message: options.message };
  });
}

function makeActions(state: AppState): DocumentActions {
  const ctx = {
    state,
    reporter,
    getMarkdown: () => 'the work that is still in the editor\n',
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/** A document opened from disk, edited, and not yet saved. */
function openedDocument(): AppState {
  const state = new AppState();
  state.filePath = 'C:\\Users\\user\\Downloads\\notes.md';
  state.knownDiskText = 'what was on disk when it was opened\n';
  state.isFirstSave = false;
  state.setModified(true);
  return state;
}

beforeEach(() => {
  saveFileThrows = null;
  pickedPath = null;
  written = [];
  clearImages();
  vi.mocked(showConfirmDialog).mockReset();
  vi.mocked(showToast).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('half (a) — a failing document write reports, and keeps the gate up', () => {
  it('says so, in a modal, naming the state and the cause', async () => {
    saveFileThrows = new Error(WINDOWS_LOCKED);
    const state = openedDocument();

    await makeActions(state).handleSave();

    const raised = dialogsRaised();
    expect(raised).toHaveLength(1);
    // Assert the body has something in it before asking what is in it —
    // #166 shipped green over a file the test read as empty.
    expect(raised[0].message.length).toBeGreaterThan(0);
    expect(raised[0]).toEqual({
      title: SAVE_FAILED_TITLE,
      message: saveFailedMessage(state.filePath as string, saveFailureCause(saveFileThrows)),
    });
  });

  it('shows the operating system sentence, and none of the scaffold around it', async () => {
    saveFileThrows = new Error(WINDOWS_LOCKED);
    const state = openedDocument();

    await makeActions(state).handleSave();
    const body = dialogsRaised()[0].message;

    expect(body).toContain('used by another process');
    // The three pieces that are noise: developer English, the path a
    // second time, and the code.
    expect(body).not.toContain('failed to open file at path');
    expect(body).not.toContain('os error');
    expect(body.split(state.filePath as string).length - 1).toBe(1);
  });

  it('leaves the document modified, and the R-C14 baseline untouched', async () => {
    saveFileThrows = new Error(WINDOWS_READONLY);
    const state = openedDocument();

    await makeActions(state).handleSave();

    expect(written).toEqual([]);
    expect(state.modified).toBe(true);
    // Nothing was written, so what AgentEd believes is on disk is still
    // what it read there.
    expect(state.knownDiskText).toBe('what was on disk when it was opened\n');
    expect(state.isFirstSave).toBe(false);
  });

  it('leaves the close gate in front of the work — the whole loop from the issue', async () => {
    saveFileThrows = new Error(WINDOWS_LOCKED);
    const state = openedDocument();
    const actions = makeActions(state);

    await actions.handleSave();
    expect(dialogsRaised()).toHaveLength(1);

    // The user closes the window. The prompt they meet is no longer
    // spurious: they were told, a moment ago, why it is there.
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    expect(await actions.confirmWindowClose()).toBe(false);
    expect(dialogsRaised()).toHaveLength(2);
  });

  it('the same for Save As, after the picker has returned a path', async () => {
    saveFileThrows = new Error(WINDOWS_READONLY);
    pickedPath = 'C:\\Users\\user\\Downloads\\renamed.md';
    const state = new AppState();
    state.setModified(true);

    await makeActions(state).handleSaveAs();

    const raised = dialogsRaised();
    expect(raised).toHaveLength(1);
    expect(raised[0].title).toBe(SAVE_FAILED_TITLE);
    expect(raised[0].message).toContain('renamed.md');
    expect(state.modified).toBe(true);
    expect(written).toEqual([]);
  });

  it('nothing escapes to the caller — main.ts must no longer be the reporter', async () => {
    saveFileThrows = new Error(WINDOWS_LOCKED);
    const state = openedDocument();

    // `handleSave` used to reject here, which is how this reached
    // `.catch(console.error)` and stopped.
    await expect(makeActions(state).handleSave()).resolves.toBeUndefined();
    expect(state.isSaving).toBe(false);
  });

  it('degrades to the whole message when there is no scaffold to split on', async () => {
    // The web build's own failures: a lapsed grant, a quota. They carry
    // no marker, and losing the shape must show too much, never nothing.
    saveFileThrows = new Error('The request is not allowed by the user agent.');
    const state = openedDocument();

    await makeActions(state).handleSave();

    expect(dialogsRaised()[0].message).toContain('The request is not allowed by the user agent.');
  });
});

describe('half (b) — a save that works is still silent, and still records everything', () => {
  it('shows nothing at all, clears the flag, and records the R-C14 baseline', async () => {
    const state = openedDocument();

    await makeActions(state).handleSave();

    expect(dialogsRaised()).toEqual([]);
    expect(vi.mocked(showToast)).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    expect(written[0].path).toBe('C:\\Users\\user\\Downloads\\notes.md');
    expect(state.modified).toBe(false);
    // The baseline is what was actually written, not what was read.
    expect(state.knownDiskText).toBe(written[0].text);
    expect(state.isFirstSave).toBe(false);
  });

  it('and closing afterwards asks nothing', async () => {
    const state = openedDocument();
    const actions = makeActions(state);

    await actions.handleSave();

    expect(await actions.confirmWindowClose()).toBe(true);
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });

  it('a retry once the cause is gone is a plain Ctrl+S', async () => {
    saveFileThrows = new Error(WINDOWS_LOCKED);
    const state = openedDocument();
    const actions = makeActions(state);
    await actions.handleSave();
    expect(dialogsRaised()).toHaveLength(1);

    // The user closes the other program and presses Ctrl+S again. This
    // is the remedy the message names, measured from the failed state.
    saveFileThrows = null;
    vi.mocked(showConfirmDialog).mockReset();
    await actions.handleSave();

    expect(dialogsRaised()).toEqual([]);
    expect(written).toHaveLength(1);
    expect(state.modified).toBe(false);
  });
});

describe('the one case that was already handled stays handled', () => {
  it('NO_DIR_HANDLE is still a toast, and still not a dialog', async () => {
    saveFileThrows = new Error(
      'NO_DIR_HANDLE: web mode requires directory access to write files ' +
        'other than the one initially opened; use Save As to acquire',
    );
    const state = openedDocument();

    await makeActions(state).handleSave();

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showToast).mock.calls[0][0]).toContain('grant folder access');
    expect(dialogsRaised()).toEqual([]);
    expect(state.modified).toBe(true);
  });
});
