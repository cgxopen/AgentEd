/**
 * File, Rename (#752) at the level the person meets it: the real
 * `renameDocument` over the real `createDocumentActions`, an in-memory disk,
 * and the real R-C14 dialog answered by clicking the button a person would.
 *
 * The rules of the name (an extension kept or refused, a taken name, a change
 * of letter case, a separator) are the native command's and are tested in
 * `src-tauri/src/rename_document.rs`. Here the native call is stood in for by
 * one that renames in the in-memory disk and refuses as the command does, and
 * what is held is the order, what moves after a rename, and what stays.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { clearImages } from '../editor/image-registry';
import { dirname } from '../platform/paths';
import type { FileEntry, FileSnapshot, PlatformIO, RenameRefusal } from '../platform/types';
import { loadRecentFiles, recordRecentFile, replaceRecentFile } from '../preferences';
import { shippedElement } from '../test-support/shipped-markup';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import {
  RENAME_FAILED_TITLE,
  RENAME_GONE_MESSAGE,
  type RenameDeps,
  renameAvailability,
  renameDocument,
  renameRefusalMessage,
  setupRenameDialog,
} from './rename-flow';
import { AppState } from './state';

const DOC = '/doc/notes.md';

let disk: Map<string, string>;
let writes: string[];
let renames: Array<[string, string]>;
let refuseWith: RenameRefusal | null;
let savePathAnswer: string | null;

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
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => savePathAnswer,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: async (path: string) => (disk.has(path) ? 'present' : 'absent'),
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
  pathsOutliveSession: true,
  renameDocument: async (path: string, name: string) => {
    if (refuseWith) throw refuseWith;
    const finalName = name.includes('.') ? name : `${name}.md`;
    const target = `${dirname(path)}/${finalName}`;
    if (target !== path && disk.has(target)) throw { kind: 'taken', detail: finalName };
    const text = disk.get(path) as string;
    disk.delete(path);
    disk.set(target, text);
    renames.push([path, target]);
    return target;
  },
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let state: AppState;
let markdown: string;
let dialogTitles: string[];
let told: string[];
let shownName: string;
let recent: Array<[string, string]>;
let redraws: number;

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
    },
    refreshSidebar: async () => {},
    setFilename: (name: string | null) => {
      shownName = name ?? 'Untitled';
    },
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

function depsFor(actions: DocumentActions, typed: string | null): RenameDeps {
  return {
    state,
    io: async () => io,
    askName: async () => typed,
    readyToRename: () => actions.readyToRename(),
    setFilename: (name) => {
      shownName = name;
    },
    redrawPanel: async () => {
      redraws += 1;
    },
    replaceRecent: (oldPath, newPath) => recent.push([oldPath, newPath]),
    tell: async (message) => {
      told.push(message);
    },
  };
}

/** Answer each dialog that appears with the button named, recording its title. */
function answerDialogsWith(answer: string): () => void {
  const seen = new WeakSet<Element>();
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay');
    if (!overlay || seen.has(overlay)) return;
    seen.add(overlay);
    dialogTitles.push(overlay.querySelector('.dialog-title')?.textContent ?? '');
    Array.from(overlay.querySelectorAll('button'))
      .find((b) => b.textContent === answer)
      ?.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

beforeEach(() => {
  disk = new Map([[DOC, '# Notes\n']]);
  writes = [];
  renames = [];
  refuseWith = null;
  savePathAnswer = null;
  dialogTitles = [];
  told = [];
  recent = [];
  redraws = 0;
  shownName = '';
  markdown = '';
  state = new AppState();
  clearImages();
  document.body.innerHTML = '';
});

async function openWithEdit(actions: DocumentActions, edit: string | null = null): Promise<void> {
  await actions.openFilePath(DOC);
  if (edit !== null) {
    markdown = edit;
    state.setModified(true);
  }
}

describe('a rename that is made', () => {
  it('moves the path, the title, the recent list and the panel, and writes nothing', async () => {
    const actions = makeActions();
    await openWithEdit(actions);
    await renameDocument(depsFor(actions, 'plan'));
    expect(renames).toEqual([[DOC, '/doc/plan.md']]);
    expect(state.filePath).toBe('/doc/plan.md');
    expect(shownName).toBe('plan.md');
    expect(recent).toEqual([[DOC, '/doc/plan.md']]);
    expect(redraws).toBe(1);
    expect(writes).toEqual([]);
    expect(told).toEqual([]);
  });

  it('keeps unsaved changes unsaved, under the new name', async () => {
    const actions = makeActions();
    await openWithEdit(actions, '# Notes\n\nNot saved yet.\n');
    await renameDocument(depsFor(actions, 'plan'));
    expect(state.modified).toBe(true);
    expect(markdown).toBe('# Notes\n\nNot saved yet.\n');
    expect(disk.get('/doc/plan.md')).toBe('# Notes\n');
    expect(writes).toEqual([]);
  });

  it('a change made outside after the rename is still caught by the next save', async () => {
    const stop = answerDialogsWith('Cancel');
    const actions = makeActions();
    await openWithEdit(actions, '# Notes\n\nEdited.\n');
    await renameDocument(depsFor(actions, 'plan'));
    disk.set('/doc/plan.md', '# Changed elsewhere\n');
    await actions.handleSave();
    stop();
    expect(dialogTitles.length).toBe(1);
    expect(writes).toEqual([]);
  });

  it('moves the R-C14 baseline with it: the next save writes the new name and asks nothing', async () => {
    const stop = answerDialogsWith('Overwrite');
    const actions = makeActions();
    await openWithEdit(actions, '# Notes\n\nEdited.\n');
    await renameDocument(depsFor(actions, 'plan'));
    await actions.handleSave();
    stop();
    expect(dialogTitles).toEqual([]);
    expect(writes).toEqual(['/doc/plan.md']);
    expect(disk.has(DOC)).toBe(false);
  });
});

describe('the order: the file, then the check of a save, then the name', () => {
  it('a file gone from disk is refused with a message, before anything else', async () => {
    const actions = makeActions();
    await openWithEdit(actions);
    disk.delete(DOC);
    await renameDocument(depsFor(actions, 'plan'));
    expect(told).toEqual([RENAME_GONE_MESSAGE]);
    expect(renames).toEqual([]);
    expect(state.filePath).toBe(DOC);
  });

  it('a file changed on disk meets the R-C14 dialog first, and Cancel renames nothing', async () => {
    const stop = answerDialogsWith('Cancel');
    const actions = makeActions();
    await openWithEdit(actions);
    disk.set(DOC, '# Changed elsewhere\n');
    await renameDocument(depsFor(actions, 'plan'));
    stop();
    expect(dialogTitles.length).toBe(1);
    expect(renames).toEqual([]);
    expect(state.filePath).toBe(DOC);
  });

  it('after Reload in that dialog the rename is made', async () => {
    const stop = answerDialogsWith('Reload');
    const actions = makeActions();
    await openWithEdit(actions);
    disk.set(DOC, '# Changed elsewhere\n');
    await renameDocument(depsFor(actions, 'plan'));
    stop();
    expect(renames).toEqual([[DOC, '/doc/plan.md']]);
    expect(markdown).toContain('Changed elsewhere');
  });

  it('after Save As in that dialog the document has moved, and no rename is made', async () => {
    const stop = answerDialogsWith('Save as…');
    savePathAnswer = '/elsewhere/copy.md';
    const actions = makeActions();
    await openWithEdit(actions);
    disk.set(DOC, '# Changed elsewhere\n');
    await renameDocument(depsFor(actions, 'plan'));
    stop();
    expect(renames).toEqual([]);
    expect(state.filePath).toBe('/elsewhere/copy.md');
    expect(writes).toEqual(['/elsewhere/copy.md']);
  });

  it('Save As chosen in that dialog and its picker cancelled: still no rename', async () => {
    const stop = answerDialogsWith('Save as…');
    savePathAnswer = null;
    const actions = makeActions();
    await openWithEdit(actions);
    disk.set(DOC, '# Changed elsewhere\n');
    await renameDocument(depsFor(actions, 'plan'));
    stop();
    expect(renames).toEqual([]);
    expect(state.filePath).toBe(DOC);
  });
});

describe('a rename that is not made leaves everything as it was', () => {
  it('a refusal of the native command: the old name, the old title, and the reason said', async () => {
    const actions = makeActions();
    await openWithEdit(actions);
    refuseWith = { kind: 'locked' };
    await renameDocument(depsFor(actions, 'plan'));
    expect(state.filePath).toBe(DOC);
    expect(shownName).toBe('notes.md');
    expect(recent).toEqual([]);
    expect(told).toEqual([renameRefusalMessage({ kind: 'locked' })]);
  });

  it('a name taken by another file is refused, both files kept', async () => {
    disk.set('/doc/plan.md', '# Plan\n');
    const actions = makeActions();
    await openWithEdit(actions);
    await renameDocument(depsFor(actions, 'plan'));
    expect(told).toEqual([renameRefusalMessage({ kind: 'taken', detail: 'plan.md' })]);
    expect(disk.get('/doc/plan.md')).toBe('# Plan\n');
    expect(disk.get(DOC)).toBe('# Notes\n');
  });

  it('a cancelled dialog asks nothing more', async () => {
    const actions = makeActions();
    await openWithEdit(actions);
    await renameDocument(depsFor(actions, null));
    expect(renames).toEqual([]);
    expect(told).toEqual([]);
  });

  it('a document never saved is not renamed, and nothing is asked', async () => {
    const actions = makeActions();
    let asked = false;
    await renameDocument({
      ...depsFor(actions, 'plan'),
      askName: async () => {
        asked = true;
        return 'plan';
      },
    });
    expect(asked).toBe(false);
    expect(renames).toEqual([]);
  });

  it('a build that cannot rename asks nothing', async () => {
    const actions = makeActions();
    await openWithEdit(actions);
    const noRename = { ...io, renameDocument: undefined };
    await renameDocument({ ...depsFor(actions, 'plan'), io: async () => noRename });
    expect(renames).toEqual([]);
  });
});

describe('the messages, one per refusal', () => {
  it('names what the person can act on', () => {
    expect(renameRefusalMessage({ kind: 'extension', detail: 'txt' })).toContain('.txt');
    expect(renameRefusalMessage({ kind: 'taken', detail: 'plan.md' })).toContain('plan.md');
    expect(renameRefusalMessage({ kind: 'other', detail: 'disk full' })).toContain('disk full');
    expect(RENAME_FAILED_TITLE).toBe('Not renamed');
  });
});

describe('the Rename dialog, in the shipped page', () => {
  beforeEach(() => {
    document.body.innerHTML = shippedElement(shippedPage, '<div id="rename-dialog"');
  });

  it('opens on the current name, its name part selected, and Enter answers what was typed', async () => {
    const ask = setupRenameDialog(() => {});
    const answer = ask('notes.md');
    const input = document.getElementById('rename-name') as HTMLInputElement;
    expect(input.value).toBe('notes.md');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    input.value = 'plan';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await answer).toBe('plan');
    expect(document.getElementById('rename-dialog')?.classList.contains('hidden')).toBe(true);
  });

  it('Escape answers nothing', async () => {
    const ask = setupRenameDialog(() => {});
    const answer = ask('notes.md');
    document
      .getElementById('rename-name')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await answer).toBeNull();
  });

  it('sits in the File menu right after Save As', () => {
    document.body.innerHTML = shippedElement(shippedPage, '<div id="menu-panel-file"');
    const ids = Array.from(document.querySelectorAll('#menu-panel-file > button'), (b) => b.id);
    expect(ids[ids.indexOf('menu-save-as') + 1]).toBe('menu-rename');
  });
});

describe('what follows a rename beyond the document', () => {
  it('the recent list holds the file once, under its new name, at the top', () => {
    localStorage.clear();
    recordRecentFile('C:/doc/other.md');
    recordRecentFile('C:/doc/notes.md');
    recordRecentFile('C:/doc/third.md');
    replaceRecentFile('C:/doc/notes.md', 'C:/doc/plan.md');
    expect(loadRecentFiles()).toEqual(['C:/doc/plan.md', 'C:/doc/third.md', 'C:/doc/other.md']);
    replaceRecentFile('C:/doc/plan.md', 'C:/doc/Plan.md');
    expect(loadRecentFiles()).toEqual(['C:/doc/Plan.md', 'C:/doc/third.md', 'C:/doc/other.md']);
  });

  it('the entry is offered only for a document with a file, on a platform that renames', () => {
    expect(renameAvailability(DOC, true)).toEqual({ rename: true });
    expect(renameAvailability(null, true)).toEqual({ rename: false });
    expect(renameAvailability(DOC, false)).toEqual({ rename: false });
  });
});
