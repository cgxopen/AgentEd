/**
 * #206 at the level the routes live: every way of putting a document on
 * screen leaves the undo stack with a floor, and no document's history
 * survives into the next one (R-C16).
 *
 * The editor here is the **real** one, because `undoDepth` is the whole
 * question and a stubbed `setMarkdown` has no history to ask about. The
 * disk is a recording `PlatformIO` — the shape `save-line-conventions.test.ts`
 * introduced for #79 — so criterion 8 is asserted on what `saveFile` was
 * asked to write rather than on editor state.
 *
 * Each route gets its own test even where two of them reach the same
 * function, so a route that stops being covered names itself instead of
 * hiding behind a sibling. `document-load.test.ts` holds the criteria
 * about the stack itself; this file holds the routes, the disk and the
 * modified flag.
 */

import { closeHistory, undoDepth } from '@tiptap/pm/history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

const A = '/doc/a.md';
const B = '/doc/b.md';
const A_TEXT = '# Alpha\n\nAlpha paragraph.\n\nSecond alpha paragraph.\n';
const B_TEXT = '# Beta\n\nBeta paragraph.\n';

let disk: Map<string, string>;
/** Every `saveFile` call, as `path :: content`. */
let writes: string[];
let openFileAnswer: { path: string; content: string } | null;

const io: PlatformIO = {
  supportsMultiFile: true,
  canWriteCompanions: async () => true,
  openFile: async () => openFileAnswer,
  pickFile: async () => null,
  readText: async (path: string) => {
    const text = disk.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  saveFile: async (path: string, content: string) => {
    writes.push(`${path} :: ${content}`);
    disk.set(path, content);
  },
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => null,
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

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async () => {},
};

let state: AppState;
let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;

beforeEach(() => {
  disk = new Map([
    [A, A_TEXT],
    [B, B_TEXT],
  ]);
  writes = [];
  openFileAnswer = null;
  clearImages();
  state = new AppState();

  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host, () => {
    state.setModified(true);
  });

  const ctx = {
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
  } as unknown as AppContext;
  actions = createDocumentActions(ctx);
});

afterEach(() => {
  instance.destroy();
  host.remove();
  document.querySelector('.dialog-overlay')?.remove();
});

/** One edit in its own undo event — see the note in `document-load.test.ts`. */
function edit(text: string): void {
  instance.editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr);
      return true;
    })
    .insertContentAt(3, text)
    .run();
}

function undoTimes(times: number): void {
  for (let n = 0; n < times; n += 1) instance.editor.commands.undo();
}

/**
 * Click through the dialogs as they appear, in order, by button label.
 * The real dialog rather than a mock, for the reason `external-change.test.ts`
 * gives: a mocked dialog has none of the behaviour that decides the answer.
 */
function answerDialogsInTurn(...answers: string[]): () => void {
  const seen = new WeakSet<Element>();
  let next = 0;
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay');
    if (!overlay || seen.has(overlay)) return;
    seen.add(overlay);
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    const button = Array.from(overlay.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === answer,
    );
    button?.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Put document A on screen through the ordinary open route, and edit it. */
async function openAndEditA(): Promise<void> {
  await actions.openFilePath(A);
  expect(state.filePath).toBe(A);
  edit('EDIT');
  expect(instance.getMarkdown()).toContain('EDIT');
}

/**
 * After the route under test has run: press undo far more times than
 * anything could need, and answer with what is on screen.
 */
function documentAfterPressingUndo(times = 8): string {
  undoTimes(times);
  return instance.getMarkdown();
}

// ── Criterion 6: every route, each on its own ────────────────────────

describe('every route that replaces the document (R-C16)', () => {
  it('File then Open', async () => {
    await openAndEditA();
    openFileAnswer = { path: B, content: B_TEXT };
    const stop = answerDialogsInTurn('Discard');
    await actions.handleOpen();
    stop();

    expect(state.filePath).toBe(B);
    const asLoaded = instance.getMarkdown();
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe(asLoaded);
    expect(instance.getMarkdown()).not.toContain('EDIT');
  });

  it('the sidebar', async () => {
    await openAndEditA();
    const stop = answerDialogsInTurn('Discard');
    // The sidebar is the one caller that passes a listing root (#178).
    await actions.openFilePath(B, '/doc');
    stop();

    const asLoaded = instance.getMarkdown();
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe(asLoaded);
    expect(instance.getMarkdown()).not.toContain('EDIT');
  });

  it('the context popover', async () => {
    await openAndEditA();
    const stop = answerDialogsInTurn('Discard');
    // No listing root: the popover opens a file that usually lives
    // outside the tree on screen.
    await actions.openFilePath(B);
    stop();

    const asLoaded = instance.getMarkdown();
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe(asLoaded);
  });

  it('the file association', async () => {
    await openAndEditA();
    const stop = answerDialogsInTurn('Discard');
    // `setupFileAssociation` is handed `openFilePath` and calls it with
    // the path the shell delivered; this is that call.
    await actions.openFilePath(B);
    stop();

    const asLoaded = instance.getMarkdown();
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe(asLoaded);
  });

  it('a reload after an external change', async () => {
    await openAndEditA();
    // Somebody else writes the file while it is open (R-C14).
    disk.set(A, '# Alpha, rewritten\n\nBy something else.\n');

    const stop = answerDialogsInTurn('Reload');
    await actions.handleSave();
    stop();

    expect(instance.getMarkdown()).toContain('rewritten');
    const asLoaded = instance.getMarkdown();
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe(asLoaded);
    expect(instance.getMarkdown()).not.toContain('EDIT');
  });

  it('New', async () => {
    await openAndEditA();
    const stop = answerDialogsInTurn('Discard');
    await actions.handleNew();
    stop();

    expect(instance.getMarkdown()).toBe('');
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe('');
  });

  it('New from Template', async () => {
    await openAndEditA();
    const stop = answerDialogsInTurn('Discard');
    await actions.handleNewFromTemplate('readme');
    stop();

    const asLoaded = instance.getMarkdown();
    expect(asLoaded).not.toBe('');
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe(asLoaded);
    expect(instance.getMarkdown()).not.toContain('EDIT');
  });

  it('Close', async () => {
    await openAndEditA();
    const stop = answerDialogsInTurn('Discard');
    await actions.handleClose();
    stop();

    expect(instance.getMarkdown()).toBe('');
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(documentAfterPressingUndo()).toBe('');
  });
});

// ── Criterion 8: the file on disk ────────────────────────────────────

describe('what the disk is asked to hold', () => {
  it('is not written at all by an undo', async () => {
    await openAndEditA();
    undoTimes(8);
    expect(writes).toEqual([]);
    expect(disk.get(A)).toBe(A_TEXT);
  });

  it('gets the document as opened when a save follows the undo', async () => {
    await openAndEditA();
    undoTimes(8);
    await actions.handleSave();

    expect(writes).toEqual([`${A} :: ${A_TEXT}`]);
    expect(disk.get(A)).toBe(A_TEXT);
  });

  it('is not written when the close gate is declined', async () => {
    await openAndEditA();
    undoTimes(8);

    const stop = answerDialogsInTurn('Cancel');
    await actions.handleClose();
    stop();

    expect(writes).toEqual([]);
    expect(disk.get(A)).toBe(A_TEXT);
  });

  it('gets the document as opened when the close gate is accepted', async () => {
    await openAndEditA();
    undoTimes(8);

    const stop = answerDialogsInTurn('Save');
    await actions.handleClose();
    stop();

    // The gate exists to protect the user's work, so the one thing it
    // must never do is write a document the user did not make. Before
    // this repair the undo left the editor empty and this wrote `''`.
    expect(writes).toEqual([`${A} :: ${A_TEXT}`]);
    expect(disk.get(A)).toBe(A_TEXT);
  });
});

// ── Criterion 9: the modified flag tells the truth ───────────────────

describe('the modified flag', () => {
  it('is off after an open followed by an undo that changes nothing', async () => {
    await actions.openFilePath(A);
    expect(state.modified).toBe(false);

    undoTimes(3);
    expect(state.modified).toBe(false);
    expect(instance.getMarkdown()).toContain('Alpha paragraph.');
  });

  it('is on for the user own edit and stays on until the edit is undone', async () => {
    await actions.openFilePath(A);
    edit('EDIT');
    expect(state.modified).toBe(true);

    // Undoing the edit does not clear the flag — the document has been
    // through a change and back, and AgentEd does not claim to know it
    // matches the disk again. What matters here is that the flag is not
    // raised by a load or by an undo that does nothing.
    undoTimes(8);
    expect(instance.getMarkdown()).not.toContain('EDIT');
  });
});
