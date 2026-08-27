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
import type { PlatformIO } from '../platform/types';
import { WebIO } from '../platform/web';
import { showConfirmDialog } from '../ui/confirm-dialog';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
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
/** Every message the reporter was asked to show, as `title: message`. */
let reported: string[];
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

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    reported.push(`${title}: ${message}`);
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

beforeEach(() => {
  agents = 'there';
  writes = [];
  reported = [];
  markdown = '';
  clearImages();
  state = new AppState();
  io = makeIO();
  vi.mocked(showConfirmDialog).mockReset();
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

    // What the user reads. The string is imported rather than copied, so
    // this asserts what they actually see (the #50 precedent).
    expect(reported).toEqual([`${OPEN_FAILED_TITLE}: ${openFailedMessage('notes/AGENTS.md')}`]);
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

    expect(reported[0]).toContain('notes/AGENTS.md');
  });

  it('the same, when the file is there but no longer reachable', async () => {
    // The second measured cause. It reaches this same exit, which is why
    // the message names neither of them as fact.
    const actions = makeActions();
    await openNotes(actions);
    agents = 'unreachable';

    await actions.openFilePath('notes/AGENTS.md');

    expect(reported).toEqual([`${OPEN_FAILED_TITLE}: ${openFailedMessage('notes/AGENTS.md')}`]);
    expect(state.filePath).toBe('notes.md');
    expect(state.knownDiskText).toBe(NOTES);
  });

  it('and a file that really is there still opens — the control', async () => {
    const actions = makeActions();
    await openNotes(actions);

    await actions.openFilePath('notes/AGENTS.md');

    expect(reported).toEqual([]);
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
    markdown = `${NOTES}an edit\n`;
    state.setModified(true);
    await actions.handleSave();

    // No dialog of any kind: not the conflict, not the "could not check".
    expect(showConfirmDialog).not.toHaveBeenCalled();
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
    agents = 'there'; // the transient failure passes before the save
    markdown = `${NOTES}an edit\n`;
    state.setModified(true);
    await actions.handleSave();

    expect(showConfirmDialog).not.toHaveBeenCalled();
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
    const asked = vi.mocked(showConfirmDialog).mock.calls[0][0] as { title: string };
    expect(asked.title).toBe('File changed on disk');
  });
});
