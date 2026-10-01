/**
 * Both open routes refuse a file whose raw HTML would cut the document, and
 * leave the document that was open exactly as it was (#455).
 *
 * The refusal is made at read, where a file that is not UTF-8 is refused, so
 * the editor, `filePath` and the R-C14 baseline are untouched: a refusal any
 * later would leave the old document under the new path, where Ctrl+S writes
 * it over the new file. File, then Open hands the text it read straight to
 * `parseDocument`, outside the `try` of the open, so it is driven here too:
 * a throw there used to reach no dialog at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions } from './document-actions';
import { OPEN_FAILED_TITLE } from './open-failure';
import { AppState } from './state';

const CUT = '# Notes\n\nBefore.\n\n<p title="one\n\ntwo">inside</p>\n\nAfter.\n';
const CUT_PATH = '/doc/cut.md';
const OPEN_PATH = '/doc/open.md';

let io: PlatformIO;

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn(async () => null) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let dialogs: Array<{ label: string; title: string | undefined }>;
let shown: string[];

function makeCtx(state: AppState): AppContext {
  return {
    state,
    reporter: {
      dialog: vi.fn(async (label: string, _error: unknown, title?: string) => {
        dialogs.push({ label, title });
      }),
    },
    setMarkdown: vi.fn((md: string) => {
      shown.push(md);
    }),
    getMarkdown: () => '# the document that was open\n',
    statusbar: { refresh: vi.fn() },
    sidebar: { hide: vi.fn(), showTree: vi.fn() },
    frontmatterPanel: { refresh: vi.fn(), setVisible: vi.fn() },
    refreshSidebar: vi.fn(async () => {}),
    setFilename: vi.fn(),
    updateCloseEnabled: vi.fn(),
  } as unknown as AppContext;
}

function setup(): { state: AppState; actions: ReturnType<typeof createDocumentActions> } {
  io = {
    openFile: vi.fn(async () => ({ path: CUT_PATH, content: CUT })),
    readText: vi.fn(async () => CUT),
    canWriteCompanions: async () => true,
  } as unknown as PlatformIO;
  const state = new AppState();
  state.filePath = OPEN_PATH;
  state.knownDiskText = 'the text on disk';
  return { state, actions: createDocumentActions(makeCtx(state)) };
}

beforeEach(() => {
  dialogs = [];
  shown = [];
});

describe('a file that would open cut is refused on every open route (#455)', () => {
  it.each([
    ['File, then Open', (a: ReturnType<typeof createDocumentActions>) => a.handleOpen()],
    [
      'a click in the files panel, the file association and Open Recent',
      (a: ReturnType<typeof createDocumentActions>) => a.openFilePath(CUT_PATH),
    ],
  ])('%s', async (_route, open) => {
    const { state, actions } = setup();

    await open(actions);

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].title).toBe(OPEN_FAILED_TITLE);
    expect(dialogs[0].label).toContain('at line 5 ');
    expect(dialogs[0].label).toContain(CUT_PATH);
    // The document that was open is still the one open, under its own path.
    expect(shown).toEqual([]);
    expect(state.filePath).toBe(OPEN_PATH);
    expect(state.knownDiskText).toBe('the text on disk');
  });
});
