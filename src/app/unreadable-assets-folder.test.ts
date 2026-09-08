/**
 * Issue #58 — an `assets/` folder that exists and cannot be read must
 * not be treated as an empty one.
 *
 * These drive the **real** insert path — `handleImageFile`, the real
 * `confirmAssetsDir`, the real reporter — over the **real platform
 * implementations**, with only the primitives beneath them stubbed. The
 * defect lived in the seam between the two layers, so a fake
 * `PlatformIO` in the middle would test the seam it replaced: the
 * desktop build reaches the naming rule through a rejected `readDir`,
 * the web build used to reach it through an empty array, and neither of
 * those is a thing an in-memory fake does by accident.
 *
 * What is measured, and what it cost before:
 *
 * - The folder is there and cannot be listed → the insert is refused and
 *   says so once. Before this, `takenNames` caught, warned to the
 *   console, and handed back a set holding only this session's names —
 *   so `buildImageName` returned a bare name that a file on disk already
 *   held, and the save wrote over it. Both inserts reported `inserted`
 *   over a destroyed file.
 * - The folder does not exist yet → unchanged, silent, successful. This
 *   is the ordinary state of every never-saved document since #14 and
 *   #45 and is the thing most at risk from a fix in this area.
 * - The folder is readable → naming and deduplication are exactly as
 *   #52 left them.
 */
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleImageFile, insertImageGesture } from '../editor/image-handler';
import type { ImageInsertOutcome } from '../editor/image-insert-outcome';
import { clearImages, getAllImages } from '../editor/image-registry';
import { DEFAULT_LINE_CONVENTIONS } from '../formats/line-conventions';
import { saveMarkdown } from '../formats/plain';
import type { PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { showToast } from '../ui/toast';
import { confirmAssetsDir } from './assets-dir';
import { DESTINATION_CUE } from './destination-cue';
import { createImageInsertReporter, imageInsertUnavailableMessage } from './image-insert-report';
import { AppState } from './state';

/**
 * How the `assets/` folder behaves in the case under test.
 *
 * `revoked` is web-only and arrived with #126: the folder grant is gone,
 * so nothing on the handle answers. It is a second way to reach the
 * unreadable exit, and it is the one a boolean `exists` could not tell
 * from an empty folder in either of the two directions it was leaned.
 */
type FolderState = 'readable' | 'absent' | 'unreadable' | 'revoked';

let folder: FolderState = 'readable';
/** The assets folder as it really is: name → bytes. */
let disk = new Map<string, Uint8Array>();
/** Every write that reached the platform, in order. */
let writes: string[] = [];

/**
 * Exactly what `plugin:fs|read_dir` sends back over the IPC when the
 * read fails: a string, not an `Error`, carrying an operating-system
 * message. Measured against `tauri-plugin-fs` 2.4.5, whose `CommandError`
 * serializes to `self.to_string()` — nothing else survives the crossing,
 * which is why nothing in the fix reads it.
 */
const IPC_READ_DIR_REJECTION =
  'failed to read directory at path: /doc/assets with error: Permission denied (os error 13)';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: async () => {
    if (folder !== 'readable') throw IPC_READ_DIR_REJECTION;
    return Array.from(disk.keys(), (name) => ({ name, isDirectory: false, isFile: true }));
  },
  exists: async () => folder !== 'absent',
  readFile: async (path: string) => {
    const bytes = disk.get(path.split('/').pop() ?? '');
    if (!bytes) throw new Error('ENOENT');
    return bytes;
  },
  writeFile: async (path: string, data: Uint8Array) => {
    const name = path.split('/').pop() ?? '';
    writes.push(`${path} [${data.join(',')}]${disk.has(name) ? ' OVER EXISTING' : ''}`);
    disk.set(name, data);
  },
  mkdir: async (path: string) => {
    writes.push(`mkdir ${path}`);
  },
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => currentIO) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let currentIO: PlatformIO;

/** The desktop platform, real, over the stubbed plugin above. */
async function desktopIO(): Promise<PlatformIO> {
  const { TauriIO } = await import('../platform/tauri');
  return new TauriIO();
}

/**
 * The web platform, real, over a directory handle that behaves the way
 * `folder` says. `assets` is looked up as a file first — `navigateTo`
 * does that — and answers `TypeMismatchError`, which is what a browser
 * says when the entry is a directory.
 */
async function webIO(): Promise<PlatformIO> {
  const { WebIO } = await import('../platform/web');
  const io = new WebIO();
  const assets = {
    values: () => ({
      [Symbol.asyncIterator]() {
        if (folder === 'unreadable') {
          return {
            next: async (): Promise<never> => {
              throw new DOMException('stub: cannot enumerate', 'NotAllowedError');
            },
          };
        }
        const names = Array.from(disk.keys());
        let i = 0;
        return {
          next: async () =>
            i >= names.length
              ? { done: true, value: undefined }
              : { done: false, value: { name: names[i++], kind: 'file' } },
        };
      },
    }),
    getFileHandle: async (name: string) => ({
      getFile: async () => ({
        arrayBuffer: async () => (disk.get(name) ?? new Uint8Array()).slice().buffer,
      }),
      createWritable: async () => ({
        write: async (data: ArrayBuffer) => {
          const bytes = new Uint8Array(data);
          writes.push(
            `assets/${name} [${bytes.join(',')}]${disk.has(name) ? ' OVER EXISTING' : ''}`,
          );
          disk.set(name, bytes);
        },
        close: async () => {},
      }),
    }),
  };
  const revoked = async (): Promise<never> => {
    throw new DOMException('stub: grant revoked', 'NotAllowedError');
  };
  (io as unknown as { dirHandle: unknown }).dirHandle = {
    getFileHandle: async (name: string) => {
      if (folder === 'revoked') return revoked();
      // `assets` is a directory, and asking a browser for it as a file
      // is a type mismatch — which is the step `navigateTo` walks past
      // before it asks for the directory.
      if (name === 'assets') throw new DOMException('stub: not a file', 'TypeMismatchError');
      return {
        createWritable: async () => ({
          write: async () => {
            writes.push(name);
          },
          close: async () => {},
        }),
      };
    },
    getDirectoryHandle: async (name: string) => {
      if (folder === 'revoked') return revoked();
      if (name !== 'assets') throw new DOMException('stub: no entry', 'NotFoundError');
      if (folder === 'absent') throw new DOMException('stub: no entry', 'NotFoundError');
      return assets;
    },
  };
  return io;
}

function stubEditor(): Editor {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  return { chain: vi.fn(() => ({ focus })) } as unknown as Editor;
}

function imageFile(name: string, bytes: number[]): File {
  const data = Uint8Array.from(bytes);
  return {
    size: data.length,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

let state: AppState;
let reported: ImageInsertOutcome[];
let report: (outcome: ImageInsertOutcome) => void;

/** One insert, wired exactly as `main.ts` wires it. */
async function insert(file: File): Promise<void> {
  await handleImageFile(
    file,
    stubEditor(),
    () => state.filePath,
    async () => null,
    async () => {
      const path = state.filePath;
      return path ? confirmAssetsDir(path, currentIO, state) : null;
    },
    async () => {
      const path = state.filePath;
      return path ? currentIO.canWriteCompanions(path) : false;
    },
    'file',
    report,
  );
}

/** The save that puts the inserted images on disk, as the app performs it. */
async function save(): Promise<unknown> {
  const result = await saveMarkdown(
    {
      frontmatterRaw: null,
      markdownBody: 'body',
      images: getAllImages(),
      rootPath: state.filePath as string,
      byteOrderMark: false,
      lineConventions: DEFAULT_LINE_CONVENTIONS,
    },
    currentIO,
  );
  return result.assetsError;
}

function toastTexts(): string[] {
  return vi.mocked(showToast).mock.calls.map((c) => String(c[0]));
}

/** What the user reads when the folder is there and shut. */
const UNREADABLE_MESSAGE = imageInsertUnavailableMessage('assets-folder-unreadable');

beforeEach(() => {
  folder = 'readable';
  // What an earlier session left in the folder.
  disk = new Map([['photo.png', Uint8Array.from([1, 1, 1, 1])]]);
  writes = [];
  reported = [];
  clearImages();
  state = new AppState();
  vi.mocked(showConfirmDialog).mockReset();
  vi.mocked(showConfirmDialog).mockResolvedValue('create');
  vi.mocked(showToast).mockReset();
  const appReporter = createImageInsertReporter(state);
  report = (outcome) => {
    reported.push(outcome);
    appReporter(outcome);
  };
});

describe('#58 — the desktop build, over the real TauriIO', () => {
  beforeEach(async () => {
    currentIO = await desktopIO();
    state.filePath = '/doc/notes.md';
  });

  it('refuses the insert when the folder is there and cannot be read', async () => {
    folder = 'unreadable';

    await insert(imageFile('photo.png', [2, 2, 2, 2]));

    expect(reported).toEqual([{ kind: 'unavailable', reason: 'assets-folder-unreadable' }]);
    expect(toastTexts()).toEqual([UNREADABLE_MESSAGE]);
    // Nothing was claimed, so the save has nothing to put in that folder
    // and the file already there survives untouched (R-C5).
    expect(getAllImages()).toEqual([]);
    await save();
    expect(writes.filter((w) => w.includes('photo.png'))).toEqual([]);
    expect(disk.get('photo.png')).toEqual(Uint8Array.from([1, 1, 1, 1]));
  });

  it('the overwrite it used to end in: the same run, with the folder readable', async () => {
    // The control for the case above. The name the failing read used to
    // hand back was `photo.png` — the one on disk. Read properly, it is
    // `photo-2.png`, and nothing is written over.
    await insert(imageFile('photo.png', [2, 2, 2, 2]));

    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(getAllImages().map((i) => i.relativePath)).toEqual(['assets/photo-2.png']);
    await save();
    expect(writes.some((w) => w.includes('OVER EXISTING'))).toBe(false);
    expect(disk.get('photo.png')).toEqual(Uint8Array.from([1, 1, 1, 1]));
  });

  it('a folder that does not exist yet stays silent and successful', async () => {
    folder = 'absent';
    disk = new Map();

    await insert(imageFile('photo.png', [2, 2, 2, 2]));

    // The ordinary path of every never-saved document since #14 and #45.
    // The only thing said is the destination cue an insert has raised
    // since #48 — no warning, no prompt.
    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(toastTexts()).toEqual([DESTINATION_CUE]);
    expect(getAllImages().map((i) => i.relativePath)).toEqual(['assets/photo.png']);
  });

  it('deduplication is untouched while the folder is readable (#52)', async () => {
    // The picture is already in assets/ under the name this insert
    // wants, byte for byte, so it is referenced rather than copied.
    await insert(imageFile('photo.png', [1, 1, 1, 1]));

    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(getAllImages().map((i) => i.relativePath)).toEqual(['assets/photo.png']);
  });

  it('a folder that shuts mid-gesture keeps what landed and speaks once', async () => {
    // The asymmetry worth naming (AMP, #58): this reason is answered
    // per file, after the destination and consent steps, so a folder
    // that becomes unreadable between two images of one paste leaves the
    // first one in the document. That is not a difference from
    // `no-folder-access`, which is also asked once per file — both are
    // terminal for the gesture and both keep what already landed. It is
    // the same shape a revoked folder grant would have.
    // The folder shuts the moment the first image has landed, which is
    // exactly between two files of one gesture.
    const shutOnFirstInsert = (outcome: ImageInsertOutcome): void => {
      report(outcome);
      if (outcome.kind === 'inserted') folder = 'unreadable';
    };

    await insertImageGesture(
      [
        imageFile('a.png', [2, 2, 2, 2]),
        imageFile('b.png', [3, 3, 3, 3]),
        imageFile('c.png', [4, 4, 4, 4]),
      ],
      stubEditor(),
      () => state.filePath,
      async () => null,
      async () => {
        const path = state.filePath;
        return path ? confirmAssetsDir(path, currentIO, state) : null;
      },
      async () => {
        const path = state.filePath;
        return path ? currentIO.canWriteCompanions(path) : false;
      },
      'file',
      shutOnFirstInsert,
    );

    expect(reported).toEqual([
      { kind: 'inserted' },
      { kind: 'unavailable', reason: 'assets-folder-unreadable' },
    ]);
    expect(toastTexts()).toEqual([DESTINATION_CUE, UNREADABLE_MESSAGE]);
    // The third file is never attempted, so it reports nothing.
    expect(getAllImages().map((i) => i.relativePath)).toEqual(['assets/a.png']);
  });

  it('one gesture over an unreadable folder speaks once and lands nothing', async () => {
    folder = 'unreadable';

    await insertImageGesture(
      [
        imageFile('a.png', [2, 2, 2, 2]),
        imageFile('b.png', [3, 3, 3, 3]),
        imageFile('c.png', [4, 4, 4, 4]),
      ],
      stubEditor(),
      () => state.filePath,
      async () => null,
      async () => {
        const path = state.filePath;
        return path ? confirmAssetsDir(path, currentIO, state) : null;
      },
      async () => {
        const path = state.filePath;
        return path ? currentIO.canWriteCompanions(path) : false;
      },
      'file',
      report,
    );

    // Terminal, like every cause that belongs to the document and its
    // folder rather than to one file: the second and third images are
    // never attempted, so they report nothing and say nothing (#46).
    expect(reported).toEqual([{ kind: 'unavailable', reason: 'assets-folder-unreadable' }]);
    expect(toastTexts()).toEqual([UNREADABLE_MESSAGE]);
    expect(getAllImages()).toEqual([]);
  });
});

describe('#58 — the web build, over the real WebIO', () => {
  beforeEach(async () => {
    currentIO = await webIO();
    // A web path is a bare name; `assets/` resolves against the granted
    // directory handle rather than against a parent (#46).
    state.filePath = 'notes.md';
  });

  it('refuses the insert when the folder is there and cannot be enumerated', async () => {
    folder = 'unreadable';

    await insert(imageFile('photo.png', [2, 2, 2, 2]));

    // This is the half that used to be worse than the desktop build:
    // `listDir` returned `[]`, so the folder looked empty, the console
    // said nothing, and the name went out unchecked.
    expect(reported).toEqual([{ kind: 'unavailable', reason: 'assets-folder-unreadable' }]);
    expect(toastTexts()).toEqual([UNREADABLE_MESSAGE]);
    expect(getAllImages()).toEqual([]);
  });

  it('a folder that does not exist yet stays silent and successful', async () => {
    folder = 'absent';
    disk = new Map();

    await insert(imageFile('photo.png', [2, 2, 2, 2]));

    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(toastTexts()).toEqual([DESTINATION_CUE]);
    expect(getAllImages().map((i) => i.relativePath)).toEqual(['assets/photo.png']);
  });

  it('refuses the insert when the folder grant is gone (#126)', async () => {
    // The second route to the unreadable exit, and the one that decides
    // which way `entryPresence` must answer `unknown`. Lean it toward
    // `absent` and this insert proceeds silently against a folder nobody
    // looked at — #58 reopened. Lean it toward `present` and the context
    // indicator invents files — #126.
    folder = 'revoked';

    await insert(imageFile('photo.png', [2, 2, 2, 2]));

    expect(reported).toEqual([{ kind: 'unavailable', reason: 'assets-folder-unreadable' }]);
    expect(toastTexts()).toEqual([UNREADABLE_MESSAGE]);
    expect(getAllImages()).toEqual([]);
  });

  it('names around the file already there while the folder is readable', async () => {
    await insert(imageFile('photo.png', [2, 2, 2, 2]));

    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(getAllImages().map((i) => i.relativePath)).toEqual(['assets/photo-2.png']);
    await save();
    expect(writes.some((w) => w.includes('OVER EXISTING'))).toBe(false);
  });
});
