/**
 * Issue #46 — the web build offers the step that makes an image insert
 * work, and says so plainly when it cannot.
 *
 * These drive the **real** insert path against a `PlatformIO` that
 * answers `canWriteCompanions` both ways, because both answers are
 * reachable on the web build and only one of them was ever visible: with
 * no directory handle the insert used to die inside the same early
 * return a deliberate cancellation takes, silently.
 *
 * The desktop half is asserted here too, in the same file and against
 * the same flow, since "the desktop build is unchanged" is a claim this
 * change has to keep rather than assume.
 */
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleImageFile, insertImageGesture } from '../editor/image-handler';
import type { ImageInsertOutcome } from '../editor/image-insert-outcome';
import { clearImages, getAllImages } from '../editor/image-registry';
import { DEFAULT_LINE_CONVENTIONS } from '../formats/line-conventions';
import { saveMarkdown } from '../formats/plain';
import { dirname } from '../platform/paths';
import type { FileEntry, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { showToast } from '../ui/toast';
import { confirmAssetsDir } from './assets-dir';
import { createImageInsertReporter } from './image-insert-report';
import { AppState } from './state';

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => currentIO) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/** Everything that reached the filesystem, in order. */
let writes: string[] = [];
let currentIO: PlatformIO;

/**
 * A platform whose answer to `canWriteCompanions` is the thing under
 * test. `folderAccess: false` is the web build before a Save As — or
 * after one whose directory picker the user dismissed.
 */
function platform(options: {
  folderAccess: boolean;
  /** Web paths are bare names; desktop paths carry a directory. */
  desktopShaped?: boolean;
}): PlatformIO {
  return {
    supportsMultiFile: true,
    canWriteCompanions: async (documentPath: string) => {
      if (options.desktopShaped) {
        const parent = dirname(documentPath);
        return parent.length > 0 && parent !== '/';
      }
      return options.folderAccess;
    },
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async (path: string) => {
      writes.push(path);
    },
    readSnapshot: async () => ({ kind: 'absent' as const }),
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async (path: string) => {
      if (!options.folderAccess) throw new Error('NO_DIR_HANDLE: no directory access');
      writes.push(path);
    },
    entryPresence: async () => 'absent' as const,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async (path: string) => {
      if (!options.folderAccess) throw new Error('NO_DIR_HANDLE: no directory access');
      writes.push(`mkdir ${path}`);
    },
    openWithSystem: async () => {},
  };
}

function stubEditor(): Editor {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  return { chain: vi.fn(() => ({ focus })) } as unknown as Editor;
}

function imageFile(name: string, seed = 1): File {
  const data = Uint8Array.from({ length: 8 }, (_, i) => seed * 16 + i);
  return {
    size: data.length,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

/** The flow exactly as `main.ts` wires it, against `io`. */
function wiring(state: AppState, io: PlatformIO, saveAs: () => Promise<string | null>) {
  return {
    getFilePath: () => state.filePath,
    requestSaveAs: saveAs,
    confirmAssetsDir: async () => {
      const path = state.filePath;
      if (!path) return null;
      return confirmAssetsDir(path, io, state);
    },
    canWriteCompanions: async () => {
      const path = state.filePath;
      if (!path) return false;
      return io.canWriteCompanions(path);
    },
  };
}

function toastTexts(): string[] {
  return vi.mocked(showToast).mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  writes = [];
  clearImages();
  vi.mocked(showConfirmDialog).mockReset().mockResolvedValue('create');
  vi.mocked(showToast).mockReset();
});

describe('#46 — the web build is offered the destination step', () => {
  it('asks where the document should live, then lands the image in assets/', async () => {
    // The web build after the user completes the save picker: the path
    // is a bare name, because `pickSavePath` returns `handle.name`, and
    // the directory handle came with it.
    const io = platform({ folderAccess: true });
    currentIO = io;
    const state = new AppState();
    const saveAs = vi.fn(async () => {
      state.filePath = 'document.md';
      return state.filePath;
    });
    const w = wiring(state, io, saveAs);
    const outcomes: ImageInsertOutcome[] = [];

    await handleImageFile(
      imageFile('shot.png'),
      stubEditor(),
      w.getFilePath,
      w.requestSaveAs,
      w.confirmAssetsDir,
      w.canWriteCompanions,
      'clipboard',
      (o) => outcomes.push(o),
    );

    // The step is offered — this is the whole of #46's cause.
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ kind: 'inserted' }]);
    // Relative, because a web `assets/` is resolved against the granted
    // directory rather than against a parent the path does not have.
    expect(getAllImages()[0]?.relativePath).toBe('assets/shot.png');
  });

  it('writes that image to disk on the save, rather than reporting a success over nothing', async () => {
    const io = platform({ folderAccess: true });
    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![shot](assets/shot.png)\n',
        images: [
          { relativePath: 'assets/shot.png', data: new Uint8Array([1]), filename: 'shot.png' },
        ],
        rootPath: 'document.md',
        byteOrderMark: false,
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );

    expect(result.assetsError).toBeNull();
    expect(writes).toEqual(['document.md', 'mkdir assets', 'assets/shot.png']);
  });
});

describe('#46 — when a companion cannot be written, the user is told', () => {
  it('reports `unavailable` and says something the user can act on', async () => {
    const io = platform({ folderAccess: false });
    currentIO = io;
    const state = new AppState();
    state.filePath = 'opened.md';
    const w = wiring(state, io, async () => state.filePath);
    const outcomes: ImageInsertOutcome[] = [];
    const report = createImageInsertReporter(state);

    await handleImageFile(
      imageFile('shot.png'),
      stubEditor(),
      w.getFilePath,
      w.requestSaveAs,
      w.confirmAssetsDir,
      w.canWriteCompanions,
      'clipboard',
      (o) => {
        outcomes.push(o);
        report(o);
      },
    );

    expect(outcomes).toEqual([{ kind: 'unavailable', reason: 'no-folder-access' }]);
    expect(getAllImages()).toHaveLength(0);

    // It speaks, unlike a cancellation.
    expect(toastTexts()).toHaveLength(1);
    const said = toastTexts()[0];
    expect(said).toContain('Save As');
    // No error code in front of a person (#46, and #13's rule).
    expect(said).not.toContain('NO_DIR_HANDLE');
    expect(said).not.toContain('dirHandle');
  });

  it('says it once for a three-image gesture, not once per file', async () => {
    const io = platform({ folderAccess: false });
    currentIO = io;
    const state = new AppState();
    state.filePath = 'opened.md';
    const w = wiring(state, io, async () => state.filePath);
    const outcomes: ImageInsertOutcome[] = [];
    const report = createImageInsertReporter(state);

    await insertImageGesture(
      [imageFile('a.png', 1), imageFile('b.png', 2), imageFile('c.png', 3)],
      stubEditor(),
      w.getFilePath,
      w.requestSaveAs,
      w.confirmAssetsDir,
      w.canWriteCompanions,
      'clipboard',
      (o) => {
        outcomes.push(o);
        report(o);
      },
    );

    // Ends the gesture, like a cancellation: the cause belongs to the
    // document and the environment, so the other two files would fail
    // identically and say so identically.
    expect(outcomes).toEqual([{ kind: 'unavailable', reason: 'no-folder-access' }]);
    expect(toastTexts()).toHaveLength(1);
  });

  it('is a different code path from a cancellation, which stays silent', async () => {
    const io = platform({ folderAccess: true });
    currentIO = io;
    const state = new AppState();
    const report = createImageInsertReporter(state);
    const outcomes: ImageInsertOutcome[] = [];

    // The user closes the destination picker. They know what they
    // refused, so nothing is said — and it is not an `unavailable`.
    await handleImageFile(
      imageFile('shot.png'),
      stubEditor(),
      () => null,
      async () => null,
      async () => null,
      async () => true,
      'clipboard',
      (o) => {
        outcomes.push(o);
        report(o);
      },
    );

    expect(outcomes).toEqual([{ kind: 'cancelled', at: 'destination' }]);
    expect(toastTexts()).toEqual([]);
  });
});

describe('#46 — the save never reports a success over images it did not write', () => {
  it('reports a failure when the companion cannot be written', async () => {
    // The branch that used to return `assetsError: null` here. It was
    // unreachable while every web insert died earlier; offering the step
    // is what would have made it live.
    const io = platform({ folderAccess: false });
    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![shot](assets/shot.png)\n',
        images: [
          { relativePath: 'assets/shot.png', data: new Uint8Array([1]), filename: 'shot.png' },
        ],
        rootPath: 'document.md',
        byteOrderMark: false,
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );

    // The document still reached disk — R-C5 never un-writes it — but
    // the failure is reported rather than swallowed.
    expect(writes).toEqual(['document.md']);
    expect(result.assetsError).not.toBeNull();
  });

  it('still says nothing when there were no images to write', async () => {
    const io = platform({ folderAccess: false });
    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '# no images\n',
        images: [],
        rootPath: 'document.md',
        byteOrderMark: false,
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );
    expect(result.assetsError).toBeNull();
  });
});

describe('#46 — the desktop build is unchanged', () => {
  it('still refuses a bare name and the filesystem root', async () => {
    const io = platform({ folderAccess: true, desktopShaped: true });
    expect(await io.canWriteCompanions('notes.md')).toBe(false);
    expect(await io.canWriteCompanions('/notes.md')).toBe(false);
    expect(await io.canWriteCompanions('/proj/notes.md')).toBe(true);
  });

  it('asks for the destination, agrees to assets/, and lands the image as before', async () => {
    const io = platform({ folderAccess: true, desktopShaped: true });
    currentIO = io;
    const state = new AppState();
    const saveAs = vi.fn(async () => {
      state.filePath = '/proj/notes.md';
      return state.filePath;
    });
    const w = wiring(state, io, saveAs);
    const outcomes: ImageInsertOutcome[] = [];

    await handleImageFile(
      imageFile('diagram.png'),
      stubEditor(),
      w.getFilePath,
      w.requestSaveAs,
      w.confirmAssetsDir,
      w.canWriteCompanions,
      'file',
      (o) => outcomes.push(o),
    );

    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ kind: 'inserted' }]);
    expect(getAllImages()[0]?.relativePath).toBe('assets/diagram.png');
    // The agreement is still the folder's (#51), and still remembered.
    expect(state.assetsDirConfirmedFor).toBe('/proj/assets');
  });

  it('keeps the agreement per folder across a second insert (#51, #66)', async () => {
    const io = platform({ folderAccess: true, desktopShaped: true });
    currentIO = io;
    const state = new AppState();
    state.filePath = '/proj/notes.md';
    const w = wiring(state, io, async () => state.filePath);

    for (const seed of [1, 2, 3]) {
      clearImages();
      await handleImageFile(
        imageFile(`shot-${seed}.png`, seed),
        stubEditor(),
        w.getFilePath,
        w.requestSaveAs,
        w.confirmAssetsDir,
        w.canWriteCompanions,
        'file',
        () => {},
      );
    }

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
  });
});
