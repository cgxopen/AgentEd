/**
 * What happens when the document reaches disk but its images do not
 * (#14, review decision on #45).
 *
 * The deliberate outcome: the save is **not** abandoned — the `.md` is
 * already written and AgentEd neither un-writes nor deletes files — but
 * the document stays **modified**, because not all of it reached the
 * disk. That is what keeps the unsaved-changes gate in front of image
 * bytes that exist only in the in-memory registry (R-C3/Q4).
 *
 * These drive the real `handleSave` and the real close gate, so the
 * assertion is about behaviour the user meets, not about a flag.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, registerImage } from '../editor/image-registry';
import type { FileEntry, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import type { AppContext } from './context';
import { createDocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

/** Set per test: what the assets phase of the save should do. */
let mkdirFails = false;
let written: string[] = [];

const io: PlatformIO = {
  supportsMultiFile: true,
  // Desktop-shaped: every path carries a directory (#46).
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async () => '',
  saveFile: async (path: string) => {
    written.push(path);
  },
  pickSavePath: async () => null,
  readSnapshot: async () => ({ kind: 'absent' as const }),
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async (path: string) => {
    written.push(path);
  },
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async (path: string) => {
    if (mkdirFails) throw new Error('EACCES: permission denied');
    written.push(`mkdir ${path}`);
  },
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));

const dialogs: string[] = [];
const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    dialogs.push(`${title}: ${message}`);
  },
};

function makeActions(state: AppState) {
  const ctx = {
    state,
    reporter,
    getMarkdown: () => '![shot](assets/shot.png)\n',
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

function documentWithOneImage(): AppState {
  const state = new AppState();
  state.filePath = '/doc/notes.md';
  registerImage('blob:shot', {
    relativePath: 'assets/shot.png',
    data: new Uint8Array([1, 2, 3]),
    filename: 'shot.png',
  });
  state.setModified(true);
  return state;
}

describe('save where the images fail but the document does not', () => {
  beforeEach(() => {
    written = [];
    dialogs.length = 0;
    mkdirFails = false;
    clearImages();
    vi.mocked(showConfirmDialog).mockReset();
  });

  it('keeps the document marked modified, and says so', async () => {
    mkdirFails = true;
    const state = documentWithOneImage();

    await makeActions(state).handleSave();

    expect(written).toEqual(['/doc/notes.md']); // the .md landed, the image did not
    expect(state.modified).toBe(true);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('Images not saved');
  });

  it('leaves the close gate in front of the image bytes', async () => {
    mkdirFails = true;
    const state = documentWithOneImage();
    const actions = makeActions(state);
    await actions.handleSave();

    // The user closes the window. Because the document is still
    // modified, the gate asks instead of letting the images vanish.
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    expect(await actions.confirmWindowClose()).toBe(false);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
  });

  it('a retry after the failure clears is a plain Ctrl+S', async () => {
    mkdirFails = true;
    const state = documentWithOneImage();
    const actions = makeActions(state);
    await actions.handleSave();

    mkdirFails = false;
    written = [];
    await actions.handleSave();

    expect(written).toEqual(['/doc/notes.md', 'mkdir /doc/assets', '/doc/assets/shot.png']);
    expect(state.modified).toBe(false);
  });

  it('clears modified and shows nothing when everything lands', async () => {
    const state = documentWithOneImage();

    await makeActions(state).handleSave();

    expect(state.modified).toBe(false);
    expect(dialogs).toEqual([]);
  });

  it('does not ask at close once a clean save has happened', async () => {
    const state = documentWithOneImage();
    const actions = makeActions(state);
    await actions.handleSave();

    expect(await actions.confirmWindowClose()).toBe(true);
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });
});
