/**
 * R-C14 at the level the user meets it: a save that finds the file
 * changed underneath it asks, and a save that finds it untouched says
 * nothing.
 *
 * These drive the real `handleSave` / `handleSaveAs` against an
 * in-memory disk, and answer the **real** `showConfirmDialog` by
 * clicking the button a user would click (#67's lesson: a mocked dialog
 * has none of the behaviour that decides the answer — including the
 * concurrency guard that refuses a second dialog, which matters here
 * because the unsaved-changes gate can be the thing that asks for the
 * save that raises this question).
 *
 * The first test is the one that would make the feature hated: a second
 * Ctrl+S in one session must not accuse AgentEd of its own write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, registerImage } from '../editor/image-registry';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

/** The disk, as these tests see it. */
let disk: Map<string, string>;
/** Every path handed to saveFile, in order. */
let writes: string[];
/** Every path the R-C14 check looked at, in order. */
let snapshots: string[];
/** Set per test: what the save picker answers. */
let savePathAnswer: string | null;
/** Set per test: make the on-disk check fail rather than answer. */
let snapshotUnreadable: boolean;
/** Set per test: make the assets/ phase of the save fail (#45). */
let mkdirFails: boolean;

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
    writes.push(path);
    disk.set(path, content);
  },
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    snapshots.push(path);
    if (snapshotUnreadable) return { kind: 'unreadable', cause: new Error('EACCES') };
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => savePathAnswer,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async (path: string) => {
    writes.push(path);
  },
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async (path: string) => {
    if (mkdirFails) throw new Error('EACCES: permission denied');
    writes.push(`mkdir ${path}`);
  },
  remove: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let state: AppState;
let markdown: string;
/** Titles of the dialogs that appeared, in order. */
let dialogTitles: string[];
/** Messages the error reporter was asked to show. */
let reportedFailures: string[];

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    reportedFailures.push(`${title}: ${message}`);
  },
};

function makeActions(): DocumentActions {
  const ctx = {
    state,
    reporter,
    getMarkdown: () => markdown,
    setMarkdown: (md: string) => {
      markdown = md;
    },
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
    editor: { commands: { clearContent: () => {} } },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/**
 * Answer the dialogs that appear, in order, recording each title. A
 * `null` answer means dismissing with Escape — what a user does when
 * they want none of the three. The last answer is reused for any
 * further dialog, so a test that expects one dialog passes one answer.
 */
function answerDialogsInTurn(...answers: Array<string | null>): () => void {
  const seen = new WeakSet<Element>();
  let next = 0;
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay');
    if (!overlay || seen.has(overlay)) return;
    seen.add(overlay);
    dialogTitles.push(overlay.querySelector('.dialog-title')?.textContent ?? '');
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    if (answer === null) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }
    const button = Array.from(overlay.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === answer,
    );
    button?.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Open a document that is on disk, then type into it. */
async function openAndEdit(actions: DocumentActions, path: string, edit: string): Promise<void> {
  await actions.openFilePath(path);
  markdown = edit;
  state.setModified(true);
}

beforeEach(() => {
  disk = new Map([['/doc/notes.md', '# Notes\n']]);
  writes = [];
  snapshots = [];
  dialogTitles = [];
  reportedFailures = [];
  savePathAnswer = null;
  snapshotUnreadable = false;
  mkdirFails = false;
  markdown = '';
  state = new AppState();
  clearImages();
  document.body.innerHTML = '';
});

describe('a save that finds the file as AgentEd left it', () => {
  it('does not ask again on the second save of a session', async () => {
    const stop = answerDialogsInTurn('Overwrite');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Notes\n\nFirst.\n');

    await actions.handleSave();
    markdown = '# Notes\n\nFirst. Second.\n';
    state.setModified(true);
    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual([]);
    expect(writes).toEqual(['/doc/notes.md', '/doc/notes.md']);
    expect(disk.get('/doc/notes.md')).toBe('# Notes\n\nFirst. Second.\n');
    expect(state.modified).toBe(false);
  });

  it('records what it wrote, not what it assembled a second time', async () => {
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Notes\n\nEdited.\n');
    await actions.handleSave();

    expect(state.knownDiskText).toBe(disk.get('/doc/notes.md'));
  });

  it('does not accuse a document assembled from a CRLF file', async () => {
    // Splitting a CRLF document with frontmatter and reassembling it is
    // not byte-exact: `assembleMarkdown` emits LF fences. So the baseline
    // is the text that was **read**, never one re-derived from the parsed
    // document — a baseline that differs from the file by one byte would
    // put this dialog in front of the user's very first save. (Since #79
    // the save re-applies the file's own conventions to the assembled
    // text, so the written text is CRLF again; the rule about where the
    // baseline comes from is unchanged, and so are these assertions.)
    disk.set('/doc/crlf.md', '---\r\ntitle: Notes\r\n---\r\n# Notes\r\n');
    const stop = answerDialogsInTurn('Overwrite');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/crlf.md', '# Notes, edited\n');

    await actions.handleSave();
    markdown = '# Notes, edited twice\n';
    state.setModified(true);
    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual([]);
  });

  it('recreates a file that was deleted on disk, without asking', async () => {
    const stop = answerDialogsInTurn('Overwrite');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Notes\n\nEdited.\n');
    disk.delete('/doc/notes.md');

    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual([]);
    expect(disk.get('/doc/notes.md')).toBe('# Notes\n\nEdited.\n');
  });
});

describe('a save that finds the file changed on disk', () => {
  it('asks, and Overwrite makes this version win — and does not ask again', async () => {
    const stop = answerDialogsInTurn('Overwrite');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    disk.set('/doc/notes.md', '# Someone else\n');

    await actions.handleSave();
    expect(dialogTitles).toEqual(['File changed on disk']);
    expect(disk.get('/doc/notes.md')).toBe('# Mine\n');

    markdown = '# Mine, again\n';
    state.setModified(true);
    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual(['File changed on disk']);
    expect(disk.get('/doc/notes.md')).toBe('# Mine, again\n');
  });

  it('Reload loads the version on disk and drops the edits made here', async () => {
    const stop = answerDialogsInTurn('Reload');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    disk.set('/doc/notes.md', '# Someone else\n');

    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual(['File changed on disk']);
    expect(writes).toEqual([]);
    expect(markdown).toBe('# Someone else\n');
    expect(state.modified).toBe(false);
    // And the baseline now describes the file that was loaded, so the
    // next save is silent.
    expect(state.knownDiskText).toBe('# Someone else\n');
  });

  it('Save as… writes this version elsewhere and leaves the other alone', async () => {
    const stop = answerDialogsInTurn('Save as…');
    savePathAnswer = '/doc/copy.md';
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    disk.set('/doc/notes.md', '# Someone else\n');

    await actions.handleSave();
    stop();

    expect(disk.get('/doc/copy.md')).toBe('# Mine\n');
    expect(disk.get('/doc/notes.md')).toBe('# Someone else\n');
    expect(state.filePath).toBe('/doc/copy.md');
    expect(state.modified).toBe(false);
  });

  it('writes nothing when the dialog is dismissed, and keeps the document modified', async () => {
    const stop = answerDialogsInTurn(null);
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    disk.set('/doc/notes.md', '# Someone else\n');

    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual(['File changed on disk']);
    expect(writes).toEqual([]);
    expect(disk.get('/doc/notes.md')).toBe('# Someone else\n');
    expect(state.modified).toBe(true);
  });

  it('catches the second of two AgentEd windows saving one file (R-C8)', async () => {
    const stop = answerDialogsInTurn('Overwrite');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Window A\n');
    await actions.handleSave();

    // The other window, which opened the same file, saves its own text.
    disk.set('/doc/notes.md', '# Window B\n');

    markdown = '# Window A, again\n';
    state.setModified(true);
    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual(['File changed on disk']);
  });

  it('says so when it could not check, rather than reporting no change', async () => {
    const stop = answerDialogsInTurn('Overwrite');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    snapshotUnreadable = true;

    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual(['Could not check the file']);
    expect(disk.get('/doc/notes.md')).toBe('# Mine\n');
  });
});

describe('the saves that must never ask', () => {
  it('a fresh document given a destination for the first time', async () => {
    const stop = answerDialogsInTurn('Overwrite');
    savePathAnswer = '/doc/fresh.md';
    const actions = makeActions();
    markdown = '# Fresh\n';
    state.setModified(true);

    await actions.handleSaveAs();
    stop();

    expect(dialogTitles).toEqual([]);
    expect(snapshots).toEqual([]); // nothing recorded, so nothing to compare
    expect(disk.get('/doc/fresh.md')).toBe('# Fresh\n');
  });

  it('the retry after a save whose images failed (#45)', async () => {
    const stop = answerDialogsInTurn('Overwrite');
    mkdirFails = true;
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '![shot](assets/shot.png)\n');
    registerImage('blob:shot', {
      relativePath: 'assets/shot.png',
      data: new Uint8Array([1, 2, 3]),
      filename: 'shot.png',
    });

    await actions.handleSave();
    expect(reportedFailures).toHaveLength(1);
    expect(state.modified).toBe(true);

    // The modal invited a retry. It must not accuse AgentEd of the write
    // it just made.
    await actions.handleSave();
    stop();

    expect(dialogTitles).toEqual([]);
    expect(reportedFailures).toHaveLength(2);
  });
});

describe('what AgentEd knows about the file it has open', () => {
  it('is forgotten when the document is closed', async () => {
    const actions = makeActions();
    await actions.openFilePath('/doc/notes.md');
    expect(state.knownDiskText).toBe('# Notes\n');

    await actions.handleClose();

    expect(state.knownDiskText).toBeNull();
  });

  it('is forgotten when the document is pointed at another file', async () => {
    savePathAnswer = '/doc/copy.md';
    const actions = makeActions();
    await actions.openFilePath('/doc/notes.md');

    await actions.requestSaveAs();

    expect(state.filePath).toBe('/doc/copy.md');
    expect(state.knownDiskText).toBeNull();
  });
});

describe('the unsaved-changes gate reaching this question', () => {
  it('asks about the conflict when the gate is what asked for the save', async () => {
    const stop = answerDialogsInTurn('Save', 'Overwrite');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    disk.set('/doc/notes.md', '# Someone else\n');

    // Closing with unsaved changes → gate → Save → the conflict. The
    // second dialog must actually open: a dialog still on screen would
    // make `showConfirmDialog` refuse it and answer `null`, which is
    // read as "cancel" — the question would be lost and the file
    // overwritten or the close silently refused.
    await actions.handleClose();
    stop();

    expect(dialogTitles).toEqual(['Unsaved changes', 'File changed on disk']);
    expect(disk.get('/doc/notes.md')).toBe('# Mine\n');
    expect(state.filePath).toBeNull(); // the close went through
  });

  it('lets Reload stand as the answer to a close, having said what it costs', async () => {
    const stop = answerDialogsInTurn('Save', 'Reload');
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    disk.set('/doc/notes.md', '# Someone else\n');

    await actions.handleClose();
    stop();

    // Two explicit decisions, in this order: close without keeping this
    // as it is, then take the version on disk over the edits made here.
    // Nothing is written, nothing on disk is lost, and the close goes
    // through because there is no longer anything unsaved.
    expect(writes).toEqual([]);
    expect(disk.get('/doc/notes.md')).toBe('# Someone else\n');
    expect(state.filePath).toBeNull();
  });

  it('refuses the close when the conflict dialog is dismissed', async () => {
    const stop = answerDialogsInTurn('Save', null);
    const actions = makeActions();
    await openAndEdit(actions, '/doc/notes.md', '# Mine\n');
    disk.set('/doc/notes.md', '# Someone else\n');

    await actions.handleClose();
    stop();

    expect(dialogTitles).toEqual(['Unsaved changes', 'File changed on disk']);
    expect(writes).toEqual([]);
    // Still open, still modified — nothing was lost on either side.
    expect(state.filePath).toBe('/doc/notes.md');
    expect(state.modified).toBe(true);
  });
});
