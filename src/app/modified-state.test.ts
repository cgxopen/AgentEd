/**
 * The modified mark follows the saved state (#441).
 *
 * Observable here, unlike the layout issues before it: the mark is state, the
 * gate reads state, and undo is a command. So these rows are where the rule
 * is verified, and the Windows pass confirms it.
 *
 * The editor is real and wired as `main.ts` wires it - every change to the
 * document asks `refreshModified` - and the document actions, the load route
 * and the discard gate are the real ones. Only the disk is a map, and one
 * test holds its write open.
 */
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, registerImage } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { parseDocument } from '../formats/index';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { type FrontmatterPanel, setupFrontmatterPanel } from '../ui/frontmatter-panel';
import type { AppContext } from './context';
import { createDiscardGate } from './discard-gate';
import { createDocumentActions, type DocumentActions } from './document-actions';
import { applyLoadedDocument } from './editor-document';
import type { ErrorReporter } from './error-reporter';
import { insertMetadata } from './insert-metadata';
import { AppState } from './state';

const PATH = '/docs/notes.md';
const disk = new Map<string, string>();
let hold: Promise<void> = Promise.resolve();
let writeBinaryFails = false;

const io: PlatformIO = {
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (p: string) => disk.get(p) ?? '',
  saveFile: async (p: string, c: string) => {
    await hold;
    disk.set(p, c);
  },
  readSnapshot: async (p: string): Promise<FileSnapshot> =>
    disk.has(p) ? { kind: 'file', text: disk.get(p) as string } : { kind: 'absent' },
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {
    if (writeBinaryFails) throw new Error('the volume went away');
  },
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn(async () => 'cancel') }));

const reporter = { dialog: async () => {}, toast: () => {} } as unknown as ErrorReporter;

interface Rig {
  readonly state: AppState;
  readonly editor: EditorInstance;
  readonly ctx: AppContext;
  readonly actions: DocumentActions;
}

let current: Rig | null = null;

beforeEach(() => {
  disk.clear();
  hold = Promise.resolve();
  writeBinaryFails = false;
  clearImages();
  vi.mocked(showConfirmDialog).mockClear();
});

afterEach(() => {
  current?.editor.destroy();
  current = null;
  document.body.innerHTML = '';
  clearImages();
});

/** An application as `main.ts` builds it, as far as the mark is concerned. */
function rig(state = new AppState(), panel?: FrontmatterPanel): Rig {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host, () => state.refreshModified());
  state.readEditorDocument = () => editor.editor.state.doc;
  state.markSaved(state.frontmatter);
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
    frontmatterPanel: panel ?? { refresh: () => {}, setVisible: () => {}, reveal: () => {} },
  } as unknown as AppContext;
  current = { state, editor, ctx, actions: createDocumentActions(ctx) };
  return current;
}

/** Open `text` from disk by the route File then Open takes. */
async function open(r: Rig, text: string): Promise<void> {
  disk.set(PATH, text);
  await applyLoadedDocument(parseDocument(text, PATH), PATH, r.ctx, io);
}

/** One edit, as its own undo step. */
function type(r: Rig, text: string): void {
  const { editor } = r.editor;
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.view.dispatch(closeHistory(editor.state.tr.insertText(text)));
}

const undo = (r: Rig) => r.editor.editor.commands.undo();
const redo = (r: Rig) => r.editor.editor.commands.redo();

describe('the mark follows the saved state (#441)', () => {
  it('an undo back to the saved text clears the mark, and a redo sets it again', async () => {
    const r = rig();
    await open(r, 'A paragraph of text.\n');
    expect(r.state.modified).toBe(false);

    type(r, ' More');
    type(r, ' words');
    expect(r.state.modified).toBe(true);

    undo(r);
    expect(r.state.modified).toBe(true);
    undo(r);
    expect(r.state.modified).toBe(false);

    redo(r);
    expect(r.state.modified).toBe(true);
  });

  it('an undo followed by a different edit keeps the mark, even back at the saved depth', async () => {
    // The row that rejected comparing undo depths: saved after an edit,
    // undone past the save, and a different edit of the same length puts the
    // depth back where the save left it while the text is not what was saved.
    const r = rig();
    await open(r, 'A paragraph of text.\n');
    type(r, ' abc');
    await r.actions.handleSave();
    expect(r.state.modified).toBe(false);

    undo(r);
    expect(r.state.modified).toBe(true);
    type(r, ' xyz');
    expect(r.state.modified).toBe(true);
  });

  it('a keystroke during a save keeps the mark after the save completes', async () => {
    // Measured on main before this: the mark cleared when the write
    // completed, and a close then discarded the keystroke without asking.
    const r = rig();
    await open(r, 'A paragraph of text.\n');
    type(r, ' saved');

    let release: () => void = () => {};
    hold = new Promise((resolve) => {
      release = resolve;
    });
    const saving = r.actions.handleSave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    type(r, ' typed during the save');
    release();
    await saving;

    expect(disk.get(PATH)).toContain('saved');
    expect(disk.get(PATH)).not.toContain('typed during the save');
    expect(r.state.modified).toBe(true);
  });

  it('images a save could not write keep the mark, through an undo, until a save writes them', async () => {
    const r = rig();
    await open(r, 'A paragraph of text.\n');
    registerImage('blob:pasted', {
      relativePath: 'assets/pasted.png',
      data: new Uint8Array([1]),
      filename: 'pasted.png',
    });
    type(r, ' edit');
    writeBinaryFails = true;
    await r.actions.handleSave();
    // The .md is on disk and matches the editor; its picture is not.
    expect(r.state.modified).toBe(true);

    type(r, ' more');
    undo(r);
    expect(r.state.modified).toBe(true);

    writeBinaryFails = false;
    await r.actions.handleSave();
    expect(r.state.modified).toBe(false);
  });

  it('a seed with content stays marked, through an edit and its undo', async () => {
    const r = rig();
    await r.actions.handleNewFromTemplate('blank-frontmatter');
    expect(r.state.modified).toBe(true);

    type(r, ' word');
    undo(r);
    expect(r.state.modified).toBe(true);
  });

  it('a never-saved empty document typed in and undone is unmarked again, as New is', async () => {
    const r = rig();
    await r.actions.handleNew();
    expect(r.state.modified).toBe(false);
    r.editor.editor.view.dispatch(closeHistory(r.editor.editor.state.tr.insertText('word', 1)));
    expect(r.state.modified).toBe(true);
    undo(r);
    expect(r.state.modified).toBe(false);
  });

  it('a metadata field changed and changed back by hand is unmarked again', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<details id="frontmatter-panel"><textarea id="frontmatter-input"></textarea></details>',
    );
    const state = new AppState();
    const r = rig(state, setupFrontmatterPanel(state));
    const field = document.getElementById('frontmatter-input') as HTMLTextAreaElement;
    await open(r, '---\ntitle: Notes\n---\nBody.\n');
    expect(state.modified).toBe(false);
    const original = field.value;

    field.value = original.replace('Notes', 'Other');
    field.dispatchEvent(new Event('input'));
    expect(state.modified).toBe(true);

    field.value = original;
    field.dispatchEvent(new Event('input'));
    expect(state.modified).toBe(false);
  });

  it('Insert Metadata, outside undo, is unmarked again when its block is deleted by hand', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<details id="frontmatter-panel"><textarea id="frontmatter-input"></textarea></details>',
    );
    const state = new AppState();
    const panel = setupFrontmatterPanel(state);
    const r = rig(state, panel);
    const field = document.getElementById('frontmatter-input') as HTMLTextAreaElement;
    await open(r, 'Body.\n');

    insertMetadata(state, panel);
    expect(state.modified).toBe(true);

    // Emptying the field is how the panel deletes a block.
    field.value = '';
    field.dispatchEvent(new Event('input'));
    expect(state.frontmatter).toBeNull();
    expect(state.modified).toBe(false);
  });
});

describe('the gate asks exactly when the mark is shown (R-C3)', () => {
  it('asks over an edit, and not once an undo has taken it back', async () => {
    const r = rig();
    await open(r, 'A paragraph of text.\n');
    const gate = createDiscardGate(r.ctx, r.actions.handleSave);

    type(r, ' word');
    expect(await gate('close')).toBe(false);
    expect(vi.mocked(showConfirmDialog)).toHaveBeenCalledTimes(1);

    undo(r);
    expect(await gate('close')).toBe(true);
    expect(vi.mocked(showConfirmDialog)).toHaveBeenCalledTimes(1);
  });
});
