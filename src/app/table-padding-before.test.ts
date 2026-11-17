/**
 * #734: a column padded before its text keeps that padding on an unedited
 * save, in every case of the table on the issue, through the real open and
 * save of the document actions against an in-memory disk.
 *
 * Measured at `447ee79` and again at `36edf16`, before the repair: the
 * padding before the text was dropped in all four cases, and in the left and
 * centred cases the separator was respelled too, because the header cell lost
 * its padding and the separator follows the header width. The detector read
 * such a column as hugged, since it only knew padding after the text, and the
 * writer only padded after the text, so both halves had to learn the side.
 *
 * A column padded after its text was already kept and is pinned here so the
 * repair cannot cost it. A column whose rows put their padding on different
 * sides is still hugged, the exception R-C2 names for rows that disagree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

let disk: Map<string, string>;

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

let state: AppState;
let editor: EditorInstance;

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    throw new Error(`unexpected failure dialog: ${title}: ${message}`);
  },
};

function makeActions(): DocumentActions {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = createEditor(host);
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
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/** Open `text` from disk, save it with no edit, and return what was written. */
async function savedUnedited(text: string): Promise<string> {
  const path = '/doc/table.md';
  disk.set(path, text);
  const actions = makeActions();
  await actions.openFilePath(path);
  state.setModified(true);
  await actions.handleSave();
  return disk.get(path) ?? '';
}

/** The cases of the table on #734, each a file a formatter could have written. */
const CASES = {
  right: '| Item | Count |\n| ---- | ----: |\n| a    |     1 |\n| b    |    23 |\n',
  none: '| Item | Count |\n| ---- | ----- |\n| a    |     1 |\n| b    |    23 |\n',
  left: '| Item |  Note |\n| ---- | :---- |\n| a    |     x |\n| b    |    yy |\n',
  // The separator dashes fill the column, the shape #734 measured respelled.
  centre: '| Item |   Mid   |\n| ---- | :-----: |\n| a    |    x    |\n| b    |   yy    |\n',
  after: '| Item | Count |\n| ---- | ----: |\n| a    | 1     |\n| b    | 23    |\n',
} as const;

const separatorOf = (text: string): string => text.split('\n')[1];

beforeEach(() => {
  disk = new Map();
  state = new AppState();
  clearImages();
  document.body.innerHTML = '';
});

describe('a column padded before its text, saved unedited (#734)', () => {
  it.each([
    ['a right-aligned column padded on the left', CASES.right],
    ['a column with no alignment padded on the left', CASES.none],
    ['a left-aligned column padded on the left', CASES.left],
    ['a centred column padded on both sides', CASES.centre],
    ['a column padded only after its text', CASES.after],
  ])('writes %s byte for byte', async (_label, text) => {
    expect(await savedUnedited(text)).toBe(text);
  });

  it.each([
    ['left-aligned', CASES.left],
    ['centred', CASES.centre],
  ])('keeps the separator of a %s column as the file spelled it', async (_label, text) => {
    expect(separatorOf(await savedUnedited(text))).toBe(separatorOf(text));
  });

  it('holds still on a second save', async () => {
    for (const text of Object.values(CASES)) {
      const first = await savedUnedited(text);
      expect(await savedUnedited(first)).toBe(first);
    }
  });
});

describe('a column whose rows put the padding on different sides', () => {
  it('is still hugged once, then holds still, as R-C2 records for rows that disagree', async () => {
    // A header padded after its text over numbers padded before theirs: the
    // shape most of the corpus files left out of this repair hold. Keeping it
    // would mean carrying each row s padding rather than the column s.
    const text = '| Name | Rate |\n| ---- | ---- |\n| a    |   12 |\n| bb   | 3    |\n';
    const first = await savedUnedited(text);
    expect(first).toBe('| Name | Rate |\n| ---- | ---- |\n| a    | 12 |\n| bb   | 3 |\n');
    expect(await savedUnedited(first)).toBe(first);
  });
});

describe('the side survives an edit in the table', () => {
  it('pads a cell the user widened on the side the column uses', async () => {
    const path = '/doc/table.md';
    disk.set(path, CASES.right);
    const actions = makeActions();
    await actions.openFilePath(path);
    let after23 = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (after23 < 0 && node.isText && node.text === '23') after23 = pos + 2;
      return after23 < 0;
    });
    editor.editor.commands.setTextSelection(after23);
    editor.editor.commands.insertContent('4567');
    state.setModified(true);
    await actions.handleSave();
    // The column widens to the new content and every cell stays right of
    // its padding; the separator follows the width in its own spelling.
    expect(disk.get(path)).toBe(
      '| Item |  Count |\n| ---- | -----: |\n| a    |      1 |\n| b    | 234567 |\n',
    );
  });
});
