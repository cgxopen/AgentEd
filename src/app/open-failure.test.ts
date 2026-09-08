/**
 * Issue #127 at the level the user meets it: clicking a file in the
 * sidebar that has gone since it was listed.
 *
 * This drives the **real** `createDocumentActions` over the **real**
 * `WebIO`, with only the browser's directory handle constructed. The
 * defect lived in the seam between those two, so a fake `PlatformIO` in
 * the middle would test the seam it replaced.
 *
 * **The branch with the most weight is the one where no dialog appears.**
 * Measured on `main` at `53fe81e`, the three save-time outcomes after the
 * identity swap were: the file there and readable → R-C14 says *changed*
 * and asks; the resolve still failing → *unverifiable* and asks; **the
 * file genuinely gone → `none`, nothing is asked, and the save writes a
 * new file under the invented name holding another document's contents.**
 * That last one is the ordinary sync-client case this issue names, so the
 * protection was thinnest exactly where the case is most likely. It is
 * the branch nothing exercised before this file.
 *
 * The R-C14 dialog is not fixed here and does not need to be: it said the
 * wrong thing because the identity was wrong, so it goes by construction
 * — the state that raised it can no longer be reached. That is shown
 * below rather than asserted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { NotUtf8Error } from '../platform/decode';
import tauriSource from '../platform/tauri.ts?raw';
import type { PlatformIO } from '../platform/types';
import { FILE_ABSENT, READ_REFUSED } from '../platform/types';
import { WebIO } from '../platform/web';
import webSource from '../platform/web.ts?raw';
import { showConfirmDialog } from '../ui/confirm-dialog';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import { createErrorReporter } from './error-reporter';
import { OPEN_FAILED_TITLE, openFailedMessage } from './open-failure';
import { AppState } from './state';

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));

const NOTES = '# Notes, the document the user actually has open\n';
const AGENTS = '# Agents, a different file entirely\n';

function dom(name: string): DOMException {
  return new DOMException(`stub: ${name}`, name);
}

/** What the granted folder holds, and how `notes/AGENTS.md` behaves. */
let agents: 'there' | 'gone' | 'unreachable';
/** Everything written through the platform, in order. */
let writes: string[];
let io: PlatformIO;

function makeIO(): PlatformIO {
  const file = (name: string, text: string) => ({
    name,
    getFile: async () => ({
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    }),
    createWritable: async () => ({
      write: async (content: string) => {
        writes.push(
          `${name} <- ${String(content).startsWith(NOTES) ? 'the Notes document' : 'something else'}`,
        );
      },
      close: async () => {},
    }),
  });
  const notesDir = {
    values: () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    }),
    getFileHandle: async (n: string) => {
      if (agents === 'unreachable') throw dom('NotAllowedError');
      if (n !== 'AGENTS.md' || agents === 'gone') throw dom('NotFoundError');
      return file('AGENTS.md', AGENTS);
    },
    getDirectoryHandle: async (): Promise<never> => {
      throw dom('NotFoundError');
    },
  };
  const web = new WebIO();
  // The handle a real session holds: `openFile` sets it when the user
  // picks their first document, and it survives the Save As that grants
  // the folder. Without it here the defect state cannot be built at all
  // — which is what the first mutation run on this file showed, by
  // turning nothing red in this file.
  (web as unknown as { fileHandle: unknown }).fileHandle = file('notes.md', NOTES);
  (web as unknown as { dirHandle: unknown }).dirHandle = {
    getFileHandle: async (n: string) => {
      if (n === 'notes') throw dom('TypeMismatchError');
      if (n !== 'notes.md') throw dom('NotFoundError');
      return file('notes.md', NOTES);
    },
    getDirectoryHandle: async (n: string) => {
      if (n !== 'notes') throw dom('NotFoundError');
      return notesDir;
    },
  };
  return web;
}

let state: AppState;
let markdown: string;

/**
 * The **real** reporter, not a fake that records its first argument.
 *
 * `ErrorReporter.dialog` composes the body from two pieces — the message
 * and, by default, the error's own text under it — and a fake that keeps
 * only the message asserts half of what the user reads. That is how the
 * decided paragraph came to ship with `Could not resolve a file handle
 * for: notes/AGENTS.md` beneath it while this file stayed green.
 *
 * So the dialog is read where it is actually assembled: at
 * `showConfirmDialog`, which is what puts words on the screen.
 */
const reporter = createErrorReporter();

/**
 * The two sentences, read from the module the words live in rather than
 * restated here — the #50 precedent, and the reason this file imports
 * `openFailedMessage` instead of quoting it.
 *
 * The refused one is asked for with a rejection carrying the platform's
 * own marker, so the test names the state the way the platform does and
 * not by copying the sentence.
 */
function notFoundMessage(path: string): string {
  return openFailedMessage(path, new Error(`${FILE_ABSENT}: stub`));
}

function refusedMessage(path: string): string {
  return openFailedMessage(path, new Error(`${READ_REFUSED}: stub`));
}

/** A rejection the platform did not mark — every desktop failure. */
function unestablishedMessage(path: string): string {
  return openFailedMessage(path, new Error('ENOENT: no such file or directory'));
}

/**
 * The #127 disjunction, written out rather than read from the module.
 *
 * **This one literal is deliberate and is the exception to the #50 rule
 * the rest of this file follows.** Asserting the unmarked case against
 * whatever `openFailedMessage` happens to return is exactly what let the
 * first draft of #173 through: the assertion moved with the function and
 * stayed green while the sentence under it changed from a disjunction
 * into a claim of absence. Pinning the bytes is what makes it fail.
 */
const HISTORICAL_127 =
  'AgentEd could not open notes/AGENTS.md. It may have been moved, renamed or removed, ' +
  'or it may no longer be readable from here. The document you had open is unchanged.';

/** Every dialog raised, as the user would read it: title, then body. */
function dialogsRaised(): Array<{ title: string; message: string }> {
  return vi.mocked(showConfirmDialog).mock.calls.map((call) => {
    const options = call[0] as { title?: string; message: string };
    return { title: options.title ?? '', message: options.message };
  });
}

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
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

beforeEach(() => {
  agents = 'there';
  writes = [];
  markdown = '';
  clearImages();
  state = new AppState();
  io = makeIO();
  vi.mocked(showConfirmDialog).mockReset();
  vi.mocked(showConfirmDialog).mockResolvedValue('ok');
});

/** The document the user actually has open, opened the way they open it. */
async function openNotes(actions: DocumentActions): Promise<void> {
  await actions.openFilePath('notes.md');
  expect(state.filePath).toBe('notes.md');
  expect(state.knownDiskText).toBe(NOTES);
}

describe('#127 — clicking a file that has gone since the sidebar listed it', () => {
  it('says so, and leaves the open document exactly where it was', async () => {
    const actions = makeActions();
    await openNotes(actions);
    agents = 'gone';

    await actions.openFilePath('notes/AGENTS.md');

    // The whole body, not the half the reporter composes first. Nothing
    // follows the paragraph — no error text, no second copy of the path.
    // This is the half a fix that routed everything through the new
    // branch would break (#173): a file that really is gone keeps its
    // own sentence.
    expect(dialogsRaised()).toEqual([
      { title: OPEN_FAILED_TITLE, message: notFoundMessage('notes/AGENTS.md') },
    ]);
    expect(dialogsRaised()[0].message).not.toBe(refusedMessage('notes/AGENTS.md'));
    // And the sentence at the end of it is a measurement, so it is
    // measured here: all three of these are what they were.
    expect(state.filePath).toBe('notes.md');
    expect(state.knownDiskText).toBe(NOTES);
    expect(markdown).toBe(NOTES);
  });

  it('names the path that was clicked, not the bare file name', async () => {
    const actions = makeActions();
    await openNotes(actions);
    agents = 'gone';

    await actions.openFilePath('notes/AGENTS.md');

    const body = dialogsRaised()[0].message;
    expect(body).toContain('notes/AGENTS.md');
    // Once, and only inside the sentence that names it.
    expect(body.split('notes/AGENTS.md').length - 1).toBe(1);
    // And nothing from the platform layer's vocabulary reaches the user.
    expect(body).not.toContain('file handle');
  });

  it('a file that is there but the folder would not answer for — not the same sentence', async () => {
    // #173. This used to reach the same exit as a deleted file and be
    // told about in the same words, because the cause was discarded in
    // `resolveFileHandle`. It is a different state and now says so.
    const actions = makeActions();
    await openNotes(actions);
    agents = 'unreachable';

    await actions.openFilePath('notes/AGENTS.md');

    expect(dialogsRaised()).toEqual([
      { title: OPEN_FAILED_TITLE, message: refusedMessage('notes/AGENTS.md') },
    ]);
    // And explicitly not the other one, which is the whole of the defect.
    expect(dialogsRaised()[0].message).not.toBe(notFoundMessage('notes/AGENTS.md'));
    // The document is still untouched, which both sentences claim.
    expect(state.filePath).toBe('notes.md');
    expect(state.knownDiskText).toBe(NOTES);
  });

  it('the marker that chose the sentence never reaches the user', async () => {
    const actions = makeActions();
    await openNotes(actions);
    agents = 'unreachable';

    await actions.openFilePath('notes/AGENTS.md');

    const body = dialogsRaised()[0].message;
    expect(body).not.toContain(READ_REFUSED);
    expect(body).not.toContain(FILE_ABSENT);
    // Nor the platform layer's own vocabulary, as #127 established.
    expect(body).not.toContain('file handle');
  });

  it('and a file that really is there still opens — the control', async () => {
    const actions = makeActions();
    await openNotes(actions);

    await actions.openFilePath('notes/AGENTS.md');

    expect(dialogsRaised()).toEqual([]);
    expect(state.filePath).toBe('notes/AGENTS.md');
    expect(state.knownDiskText).toBe(AGENTS);
    expect(markdown).toBe(AGENTS);
  });
});

describe('#127 — the R-C14 dialog goes because the state that raised it cannot be reached', () => {
  it('the expensive branch: the file is gone, and the save writes the right file', async () => {
    // Before this change: the click answered with the open document,
    // `filePath` became `notes/AGENTS.md` and `knownDiskText` became the
    // Notes text; the save then found the path **absent**, so R-C14
    // reported `none`, asked nothing, and wrote a new `notes/AGENTS.md`
    // holding the Notes document. Nothing was said anywhere.
    const actions = makeActions();
    await openNotes(actions);
    agents = 'gone';

    await actions.openFilePath('notes/AGENTS.md');
    // That click raised its own dialog, asserted above. What this test is
    // about is the save that follows.
    expect(dialogsRaised()).toHaveLength(1);
    vi.mocked(showConfirmDialog).mockClear();
    markdown = `${NOTES}an edit\n`;
    state.setModified(true);
    await actions.handleSave();

    // No dialog of any kind: not the conflict, not the "could not check".
    expect(dialogsRaised()).toEqual([]);
    // And the write went to the document the user actually had open.
    expect(writes).toEqual(['notes.md <- the Notes document']);
  });

  it('the branch that used to ask: the file is there, and it still asks nothing', async () => {
    // This is where R-C14 said "AGENTS.md has changed on disk since it
    // was opened here" about a file that was never opened here. The
    // sentence goes with the identity it described.
    const actions = makeActions();
    await openNotes(actions);
    agents = 'unreachable';

    await actions.openFilePath('notes/AGENTS.md');
    expect(dialogsRaised()).toHaveLength(1);
    vi.mocked(showConfirmDialog).mockClear();
    agents = 'there'; // the transient failure passes before the save
    markdown = `${NOTES}an edit\n`;
    state.setModified(true);
    await actions.handleSave();

    expect(dialogsRaised()).toEqual([]);
    expect(writes).toEqual(['notes.md <- the Notes document']);
  });

  it('and R-C14 still asks when it should — the control', async () => {
    // The dialog is not disabled, only starved of the false state. A
    // document whose file genuinely changed underneath it still asks.
    const actions = makeActions();
    await openNotes(actions);
    state.knownDiskText = '# something else entirely\n';
    markdown = `${NOTES}an edit\n`;
    state.setModified(true);
    vi.mocked(showConfirmDialog).mockResolvedValue('overwrite');

    await actions.handleSave();

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(dialogsRaised()[0].title).toBe('File changed on disk');
  });
});

/**
 * #173 is `WebIO` only, and this says so rather than leaving it implied.
 *
 * The desktop build reaches a document through `TauriIO.readText`, which
 * calls the filesystem plugin directly: there is no `resolveFileHandle`
 * on that path, no folder handle to lapse, and nothing that could mark a
 * rejection. So an unmarked rejection is the only kind it can produce,
 * and the sentence it produces is the one it always produced.
 *
 * Read from the sources rather than asserted in prose, because the claim
 * is about which file holds what. A later change that wired the marker
 * into the desktop path would turn this red, which is the point.
 */
describe('#173 — the desktop path is untouched, and is asserted to be', () => {
  it('the sources have content before anything is concluded from them (#166)', () => {
    expect(tauriSource.length).toBeGreaterThan(0);
    expect(webSource.length).toBeGreaterThan(0);
  });

  it('TauriIO has its own readText and readBinary, and neither goes near the branch', () => {
    expect(tauriSource).toContain('async readText(');
    expect(tauriSource).toContain('async readBinary(');
    expect(tauriSource).not.toContain('resolveFileHandle');
    expect(tauriSource).not.toContain(READ_REFUSED);
    expect(tauriSource).not.toContain(FILE_ABSENT);
  });

  it('the branch and the marker exist only in WebIO', () => {
    expect(webSource).toContain('private async resolveFileHandle(');
    expect(webSource).toContain(READ_REFUSED);
    expect(webSource).toContain(FILE_ABSENT);
  });

  it('a rejection carrying no marker claims neither state — the #127 disjunction', () => {
    // Which is **every** desktop failure: `TauriIO` has no folder handle
    // to ask, so it establishes nothing and marks nothing. A file locked
    // by another program, a permission that changed, a disconnected
    // network drive — ordinary on Windows (#171) — must not be reported
    // as possibly deleted.
    //
    // Pinned to the bytes, not to what the function returns. See
    // HISTORICAL_127 for why that distinction is the whole test.
    expect(unestablishedMessage('notes/AGENTS.md')).toBe(HISTORICAL_127);
    expect(openFailedMessage('notes/AGENTS.md', undefined)).toBe(HISTORICAL_127);
  });

  it('and the not-found claim is reserved for a platform that established it', () => {
    // The same path, the same failure to open, two different sentences —
    // separated only by whether anything looked in a folder and got an
    // answer back.
    expect(unestablishedMessage('notes/AGENTS.md')).not.toBe(notFoundMessage('notes/AGENTS.md'));
  });

  it('all three sentences differ from each other, so no assertion passes vacuously', () => {
    const three = [refusedMessage('x.md'), notFoundMessage('x.md'), unestablishedMessage('x.md')];
    expect(new Set(three).size).toBe(3);
  });
});

describe('the encoding refusal reaches the route the owner run used (#259)', () => {
  const path = 'C:/Users/vasil/Downloads/b-cp1250.md';
  const message = openFailedMessage(path, new NotUtf8Error(path));

  it('names the encoding rather than guessing at the file', () => {
    expect(message).toContain('UTF-8');
    expect(message).toContain(path);
  });

  // The defect this branch exists for: before it, a file that had been
  // found and read answered with the disjunction, which claims a cause
  // that is false here.
  it('does not repeat the moved-renamed-removed sentence', () => {
    expect(message).not.toContain('moved, renamed or removed');
    expect(message).not.toContain('no longer be readable');
  });

  it('names a step the user can take, and it is one they take elsewhere', () => {
    expect(message).toContain('Save As');
    expect(message).toContain('UTF-8');
    // A step, never an offer: AgentEd declines to destroy a legacy file
    // rather than undertaking to rescue one.
    expect(message).not.toMatch(/AgentEd (can|will|could) convert/i);
    expect(message).toContain('Nothing has changed on disk');
  });

  it('says nothing on disk moved, which is what the read path guarantees', () => {
    // The user has just clicked expecting a document to appear. On a
    // rejection `loadDocument` throws before `applyBundle` runs, so the
    // editor, the path and the R-C14 baseline are all untouched - and
    // the refused file was never written to either. One clause covers
    // both, which is why it is not two.
    expect(message).toContain('Nothing has changed on disk');
  });

  it('puts the path last and on its own line, so it does not bury the reason', () => {
    const blocks = message.split('\n\n');
    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toBe(path);
    expect(blocks[0]).toContain('UTF-8');
  });

  it('does not repeat what the dialog title already says', () => {
    expect(message).not.toContain('could not be opened');
    expect(message).not.toContain('could not open');
  });
});
