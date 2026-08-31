/**
 * Issue #141 — the route, end to end, over the real `WebIO`.
 *
 * `src/platform/open-identity.test.ts` pins what the platform answers.
 * These drive **File → Open followed by a save**, because that pair is
 * where the defect did its damage and where acceptance criterion 3
 * lives: an open that reaches the picked file and a save that lands
 * somewhere else would be a worse trade than the loud failure it
 * replaces, not a fix.
 *
 * The IO is the real `WebIO` with handles constructed — a fake IO would
 * pass with the whole thing reverted, because the defect *is* the
 * platform's name resolution.
 *
 * Measured at `78ba8dc`, before the change: with a grant in place and a
 * `notes.md` at the grant root, opening `doc/notes.md` put the **root**
 * file's text into the editor under the picked file's name, and the save
 * that followed wrote the user's document into that root file. Where no
 * such file existed, `readText` threw and the open failed with
 * `Could not resolve a file handle for: notes.md`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebIO } from '../platform/web';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import { AppState } from './state';

const PICKED = '# the file the user picked\n';
const NEIGHBOUR = '# a different file, wearing the same name\n';
const EDITED = '# the user edited it\n';

let io: WebIO;

vi.mock('../platform/detect', () => ({ isTauri: false }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn(async () => null) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

// ── A file system built from handles ──

interface StubFile extends FileSystemFileHandle {
  current(): string;
}

function fileHandle(name: string, initial: string): StubFile {
  let text = initial;
  return {
    kind: 'file',
    name,
    getFile: async () =>
      ({
        text: async () => text,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
      }) as unknown as File,
    createWritable: async () =>
      ({
        write: async (data: unknown) => {
          text = String(data);
        },
        close: async () => {},
      }) as unknown as FileSystemWritableFileStream,
    current: () => text,
  } as StubFile;
}

type Tree = { [name: string]: string | Tree };

interface StubDir extends FileSystemDirectoryHandle {
  files: Map<string, StubFile>;
  dirs: Map<string, StubDir>;
}

function dirHandle(name: string, tree: Tree): StubDir {
  const files = new Map<string, StubFile>();
  const dirs = new Map<string, StubDir>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') files.set(key, fileHandle(key, value));
    else dirs.set(key, dirHandle(key, value));
  }
  const dir = {
    kind: 'directory',
    name,
    files,
    dirs,
    getFileHandle: async (n: string, options?: { create?: boolean }) => {
      const existing = files.get(n);
      if (existing) return existing;
      if (!options?.create) throw new DOMException('stub: no entry', 'NotFoundError');
      const created = fileHandle(n, '');
      files.set(n, created);
      return created;
    },
    getDirectoryHandle: async (n: string, options?: { create?: boolean }) => {
      const existing = dirs.get(n);
      if (existing) return existing;
      if (!options?.create) throw new DOMException('stub: no entry', 'NotFoundError');
      const created = dirHandle(n, {});
      dirs.set(n, created);
      return created;
    },
    values: () => {
      const all = [...files.values(), ...dirs.values()];
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: async () =>
          i >= all.length
            ? { done: true as const, value: undefined }
            : { done: false as const, value: all[i++] },
      };
    },
    removeEntry: async () => {},
    resolve: async (descendant: FileSystemHandle) => {
      function find(current: StubDir, prefix: string[]): string[] | null {
        for (const file of current.files.values()) {
          if (file === descendant) return [...prefix, file.name];
        }
        for (const sub of current.dirs.values()) {
          if (sub === descendant) return [...prefix, sub.name];
          const deeper = find(sub, [...prefix, sub.name]);
          if (deeper) return deeper;
        }
        return null;
      }
      return find(dir, []);
    },
  } as unknown as StubDir;
  return dir;
}

// ── The application around it ──

/** What the editor was told to show, so a swap is visible. */
let shown: string[] = [];
let dialogs: string[] = [];

function makeCtx(state: AppState): AppContext {
  return {
    state,
    reporter: {
      dialog: vi.fn(async (label: string) => {
        dialogs.push(label);
      }),
    },
    setMarkdown: vi.fn((md: string) => {
      shown.push(md);
    }),
    getMarkdown: () => EDITED,
    statusbar: { refresh: vi.fn() },
    sidebar: { hide: vi.fn(), showTree: vi.fn() },
    frontmatterPanel: { refresh: vi.fn(), setVisible: vi.fn() },
    refreshSidebar: vi.fn(async () => {}),
    setFilename: vi.fn(),
    updateCloseEnabled: vi.fn(),
  } as unknown as AppContext;
}

/**
 * A granted folder holding `doc/notes.md`, and a `notes.md` of its own
 * at the root. `outside` puts the picked file in a different tree
 * instead — the state where the grant cannot name it at all.
 */
function scenario(where: 'subfolder' | 'outside'): {
  state: AppState;
  ctx: AppContext;
  actions: DocumentActions;
  picked: StubFile;
  neighbour: StubFile;
} {
  const grant = dirHandle('project', { doc: { 'notes.md': PICKED }, 'notes.md': NEIGHBOUR });
  const elsewhere = dirHandle('desktop', { 'notes.md': PICKED });
  const picked = (
    where === 'subfolder'
      ? grant.dirs.get('doc')?.files.get('notes.md')
      : elsewhere.files.get('notes.md')
  ) as StubFile;

  io = new WebIO();
  (io as unknown as { dirHandle: unknown }).dirHandle = grant;
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(async () => [
    picked,
  ]);

  const state = new AppState();
  const ctx = makeCtx(state);
  return {
    state,
    ctx,
    actions: createDocumentActions(ctx),
    picked,
    neighbour: grant.files.get('notes.md') as StubFile,
  };
}

beforeEach(() => {
  shown = [];
  dialogs = [];
});

describe.each([
  'subfolder',
  'outside',
] as const)('#141 — File → Open on a file the grant root also has a name for (%s)', (where) => {
  it('opens the picked file, not its same-named neighbour', async () => {
    const { state, actions } = scenario(where);

    await actions.handleOpen();

    expect(dialogs).toEqual([]);
    expect(shown).toEqual([PICKED]);
    // The R-C14 baseline is the picked file's text, so the next save
    // compares against the file it is about to write.
    expect(state.knownDiskText).toBe(PICKED);
  });

  it('and a save afterwards writes to the file that was opened', async () => {
    const { state, actions, picked, neighbour } = scenario(where);

    await actions.handleOpen();
    state.setModified(true);
    await actions.handleSave();

    expect(picked.current()).toBe(EDITED);
    expect(neighbour.current()).toBe(NEIGHBOUR);
    expect(state.modified).toBe(false);
  });

  it('with no conflict dialog about a document the user never opened', async () => {
    // Measured before the change, in the `outside` state: the baseline
    // was the neighbour's text and the save resolved to the neighbour,
    // so R-C14 answered `none` — silence over the wrong file. With the
    // baseline taken from the picked file and the lookup still wrong,
    // it answers `changed` and asks about a file the user never chose.
    // Both are gone; the correct answer here is silence over the right
    // file.
    const { showConfirmDialog } = await import('../ui/confirm-dialog');
    const { state, actions } = scenario(where);

    await actions.handleOpen();
    state.setModified(true);
    await actions.handleSave();

    expect(showConfirmDialog).not.toHaveBeenCalled();
  });
});

describe('#141 — the open no longer reads the file a second time', () => {
  it('nothing calls readText on this route', async () => {
    // Shape 1, pinned: `openFile` read the file from the handle the user
    // picked, and that text is what the editor gets. The second read was
    // the lookup by name that could reach a different file — asserted
    // gone rather than assumed gone.
    const { actions } = scenario('subfolder');
    const readText = vi.spyOn(io, 'readText');

    await actions.handleOpen();

    expect(readText).not.toHaveBeenCalled();
    expect(shown).toEqual([PICKED]);
  });
});

describe('#141 — a cancelled picker still changes nothing', () => {
  it('no document, no dialog', async () => {
    const { state, actions } = scenario('subfolder');
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(async () => {
      throw new DOMException('stub: cancelled', 'AbortError');
    });

    await actions.handleOpen();

    expect(shown).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(state.filePath).toBeNull();
  });
});
