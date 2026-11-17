/**
 * #737: every way out of the R-C14 dialog that is not one of its three
 * choices writes nothing, and leaves the document as it was and still
 * modified. That holds for both variants, File changed on disk and Could
 * not check the file, and for the Cancel button the issue adds.
 *
 * Like `external-change.test.ts`, these drive the real `handleSave`
 * against an in-memory disk and answer the real `showConfirmDialog` the
 * way a person does: a key on the document, a click on the overlay, a
 * click on a button. The window close is the real close guard asked
 * while the dialog is on screen, which is what the platform layer does
 * when the window close button, Alt+F4, Cmd+W or Cmd+Q arrives.
 *
 * What this harness cannot see: layout, so whether four buttons fit at
 * 600 by 400 and at 150 per cent is measured in Chromium and on the
 * owner pass; and the undo history of a real editor, which is stood in
 * for here by the editor content never being set after the edit. The
 * owner pass is where both are verified.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { showToast } from '../ui/toast';
import { createCloseGuard, SAVING_CLOSE_MESSAGE } from './close-guard';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

/** The disk, as these tests see it. */
let disk: Map<string, string>;
/** Every write of any kind, in order: text, binary and folders. */
let writes: string[];
/** How many times the save picker was opened. */
let pickerOpened: number;
/** Set per test: make the on-disk check fail rather than answer. */
let snapshotUnreadable: boolean;

const io: PlatformIO = {
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
    if (snapshotUnreadable) return { kind: 'unreadable', cause: new Error('EACCES') };
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => {
    pickerOpened += 1;
    return null;
  },
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async (path: string) => {
    writes.push(path);
  },
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async (path: string) => {
    writes.push(`mkdir ${path}`);
  },
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let state: AppState;
let markdown: string;
/** How many times the editor content was replaced since the edit. */
let contentReplaced: number;

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async () => {},
};

function makeActions(): DocumentActions {
  const ctx = {
    state,
    reporter,
    getMarkdown: () => markdown,
    setMarkdown: (md: string) => {
      markdown = md;
      contentReplaced += 1;
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

const PATH = '/doc/notes.md';
const EDIT = '# Mine\n';

/** The two variants of the dialog, and how each is raised. */
const VARIANTS = [
  {
    title: 'File changed on disk',
    raise: () => disk.set(PATH, '# Someone else\r\nwith a CRLF line\r\n'),
  },
  {
    title: 'Could not check the file',
    raise: () => {
      snapshotUnreadable = true;
    },
  },
] as const;

/** The dialog on screen, or null. */
function overlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.dialog-overlay');
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return Array.from(overlay()?.querySelectorAll('button') ?? []).find(
    (b) => b.textContent === label,
  );
}

function pressKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

/** Run `act` once, when the first dialog appears; record its title. */
function whenDialogAppears(act: () => void | Promise<void>): {
  titles: string[];
  stop: () => void;
} {
  const titles: string[] = [];
  let acted = false;
  const observer = new MutationObserver(() => {
    const shown = overlay();
    if (!shown || acted) return;
    acted = true;
    titles.push(shown.querySelector('.dialog-title')?.textContent ?? '');
    void act();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { titles, stop: () => observer.disconnect() };
}

/**
 * Open the document, edit it, raise the variant, then save while `act`
 * answers the dialog. Returns what the disk held before the save, and the
 * titles of the dialogs that appeared.
 */
async function saveAnsweredBy(
  variant: (typeof VARIANTS)[number],
  act: () => void | Promise<void>,
): Promise<{ before: Array<[string, string]>; titles: string[] }> {
  const actions = makeActions();
  await actions.openFilePath(PATH);
  markdown = EDIT;
  state.setModified(true);
  contentReplaced = 0;
  variant.raise();
  const before = Array.from(disk.entries());

  const watch = whenDialogAppears(act);
  await actions.handleSave();
  watch.stop();
  return { before, titles: watch.titles };
}

/** What every way of stepping back must leave behind. */
function expectNothingWrittenAndStillModified(before: Array<[string, string]>): void {
  expect(writes).toEqual([]);
  expect(Array.from(disk.entries())).toEqual(before);
  expect(state.modified).toBe(true);
  expect(markdown).toBe(EDIT);
  expect(contentReplaced).toBe(0);
  expect(overlay()).toBeNull();
}

beforeEach(() => {
  disk = new Map([[PATH, '# Notes\n']]);
  writes = [];
  pickerOpened = 0;
  snapshotUnreadable = false;
  markdown = '';
  contentReplaced = 0;
  state = new AppState();
  document.body.innerHTML = '';
  vi.mocked(showToast).mockClear();
});

describe.each(VARIANTS)('the dialog $title', (variant) => {
  it('writes nothing on Escape, and keeps the document modified', async () => {
    const { before, titles } = await saveAnsweredBy(variant, () => pressKey('Escape'));
    expect(titles).toEqual([variant.title]);
    expectNothingWrittenAndStillModified(before);
  });

  it('writes nothing on a click outside it, and keeps the document modified', async () => {
    const { before, titles } = await saveAnsweredBy(variant, () => overlay()?.click());
    expect(titles).toEqual([variant.title]);
    expectNothingWrittenAndStillModified(before);
  });

  it('writes nothing on Cancel, and keeps the document modified', async () => {
    let found = false;
    const { before, titles } = await saveAnsweredBy(variant, () => {
      const cancel = buttonLabelled('Cancel');
      found = cancel !== undefined;
      // Without the button, step back the only way there is, so the save
      // ends and the missing button is what fails, not a timeout.
      if (cancel) cancel.click();
      else pressKey('Escape');
    });
    expect(titles).toEqual([variant.title]);
    expect(found).toBe(true);
    expectNothingWrittenAndStillModified(before);
  });

  it('refuses a window close while it is up, then writes nothing when stepped back from', async () => {
    let closeAllowed: boolean | null = null;
    let stillUp = false;
    const { before } = await saveAnsweredBy(variant, async () => {
      // `actions` is not needed by the guard on this branch: the save in
      // flight refuses the close before anything else is asked.
      const guard = createCloseGuard(state, {} as DocumentActions);
      closeAllowed = await guard.confirmClose();
      stillUp = overlay() !== null;
      pressKey('Escape');
    });
    expect(closeAllowed).toBe(false);
    expect(stillUp).toBe(true);
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(SAVING_CLOSE_MESSAGE);
    expectNothingWrittenAndStillModified(before);
  });

  it('offers Cancel first and plain, and leaves the three choices as they were', async () => {
    // Which button is the default is the Enter test below, not this one.
    let buttons: Array<{ label: string; look: string }> = [];
    await saveAnsweredBy(variant, () => {
      buttons = Array.from(overlay()?.querySelectorAll('button') ?? []).map((b) => ({
        label: b.textContent ?? '',
        look: b.className,
      }));
      pressKey('Escape');
    });
    expect(buttons).toEqual([
      { label: 'Cancel', look: '' },
      { label: 'Reload', look: 'danger' },
      { label: 'Overwrite', look: 'danger' },
      { label: 'Save as…', look: 'primary' },
    ]);
  });

  it('takes Enter as Save as, wherever the focus is', async () => {
    // A first save learns the labels on screen and steps back. Then each
    // button in turn holds the focus when Enter arrives; Enter still means
    // the default, so it opens the picker every time.
    const focusedLabels: string[] = [];
    await saveAnsweredBy(variant, () => {
      for (const b of Array.from(overlay()?.querySelectorAll('button') ?? [])) {
        focusedLabels.push(b.textContent ?? '');
      }
      pressKey('Escape');
    });

    for (const label of focusedLabels) {
      writes = [];
      pickerOpened = 0;
      document.body.innerHTML = '';
      state = new AppState();
      disk = new Map([[PATH, '# Notes\n']]);
      snapshotUnreadable = false;
      await saveAnsweredBy(variant, () => {
        buttonLabelled(label)?.focus();
        pressKey('Enter');
      });
      expect({ label, pickerOpened }).toEqual({ label, pickerOpened: 1 });
      // The picker answered nothing, so this is Save as backed out of.
      expect(writes).toEqual([]);
      expect(state.modified).toBe(true);
    }
    expect(focusedLabels.length).toBeGreaterThan(0);
  });
});
