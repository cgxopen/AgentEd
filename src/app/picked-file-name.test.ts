/**
 * Issue #145 — Insert, Image on the web wrote the image as
 * `picked-<name>.png`, an internal prefix reaching a file name on disk.
 *
 * `WebIO.pickFile` answers a pseudo-path, `picked:<name>`, and keys the
 * handle by it. The read side was always right — `readBinary` serves it
 * from the registry before any resolution. What was wrong is that the
 * pseudo-path was the *whole* answer, so the caller's only route to a
 * name was `basename` of it, and `basename` of a string with no slash
 * returns the whole string, exactly as documented. That value became the
 * `File` name, and the `File` name is what the naming rule sanitizes
 * into the name written into `assets/` — with the colon and the space
 * turned into hyphens, which is what made it look deliberate.
 *
 * Measured at `806f398`, over this harness, for a source file called
 * `Diagramă finală.png`:
 *
 * | platform | name written into `assets/` |
 * | --- | --- |
 * | web | `picked-Diagrama-finala.png` |
 * | desktop | `Diagrama-finala.png` |
 *
 * **R-C5**: files that already have a name keep it, sanitized for
 * portability. The prefix is not part of the name the user knows the file
 * by. The owner met this by hand during the #147 pass and reported the
 * same disagreement between the two builds.
 *
 * The fix is a contract change: `pickFile` answers a `PickedFile` — a
 * reference the platform resolves, and the name the file is called — so
 * nothing above `src/platform` derives one from the other.
 *
 * **The assertion here is the name written into `assets/`, read where it
 * lands**, plus the reference the document carries. Not the pseudo-path
 * and not an intermediate: reading an intermediate is how a test asserts
 * half of what the user gets (#134).
 */
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, getAllImages } from '../editor/image-registry';
import { DEFAULT_LINE_CONVENTIONS } from '../formats/line-conventions';
import { saveMarkdown } from '../formats/plain';
import { basename } from '../platform/paths';
import type { FileEntry, PlatformIO } from '../platform/types';
import { WebIO } from '../platform/web';
import { insertMedia } from './media-picker';
import { AppState } from './state';

/** A name that exercises the whole sanitizing rule: a space and two diacritics. */
const SOURCE_NAME = 'Diagramă finală.png';
/** What R-C5 says that file keeps, sanitized for portability. */
const SANITIZED = 'Diagrama-finala.png';

let io: PlatformIO;

vi.mock('../platform/detect', () => ({ isTauri: false }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn(async () => null) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

// ── A file system built from handles ──

interface StubFile extends FileSystemFileHandle {
  current(): string;
}

function fileHandle(name: string, initial: string, failing = false): StubFile {
  let text = initial;
  return {
    kind: 'file',
    name,
    getFile: async () => {
      if (failing) throw new DOMException('stub: gone', 'NotFoundError');
      return {
        text: async () => text,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
      } as unknown as File;
    },
    createWritable: async () =>
      ({
        write: async (data: unknown) => {
          text = typeof data === 'string' ? data : `<${(data as ArrayBuffer).byteLength} bytes>`;
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
    resolve: async () => null,
  } as unknown as StubDir;
  return dir;
}

// ── The application around it ──

function stubEditor(): Editor {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  return { chain: vi.fn(() => ({ focus })) } as unknown as Editor;
}

let dialogs: string[] = [];

/**
 * The real `insertMedia`, wired as `main.ts` wires it, then the real save
 * — so the assertion can be the file that appears in `assets/`.
 */
async function insertAndSave(documentPath: string): Promise<void> {
  const state = new AppState();
  state.filePath = documentPath;
  await insertMedia({
    state,
    editor: stubEditor(),
    requestSaveAs: async () => documentPath,
    reporter: {
      dialog: vi.fn(async (message: string) => {
        dialogs.push(message);
      }),
    } as never,
    report: vi.fn(),
  });
  await saveMarkdown(
    {
      frontmatterRaw: null,
      markdownBody: '',
      images: getAllImages(),
      rootPath: documentPath,
      byteOrderMark: false,
      lineConventions: DEFAULT_LINE_CONVENTIONS,
    },
    io,
  );
}

/**
 * The web build: the real `WebIO`, a granted folder holding `assets/`, and
 * the source file in front of the picker.
 */
function webPlatform(sourceName = SOURCE_NAME, failing = false): StubDir {
  const grant = dirHandle('project', { assets: {}, 'notes.md': '# doc' });
  const source = fileHandle(sourceName, 'IMAGE BYTES', failing);
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(async () => [
    source,
  ]);
  const web = new WebIO();
  (web as unknown as { dirHandle: unknown }).dirHandle = grant;
  io = web;
  return grant;
}

/**
 * The desktop build, as an IO whose `pickFile` answers what
 * `TauriIO.pickFile` answers — an absolute path from the OS dialog, and
 * `basename` of it.
 *
 * **`TauriIO` itself cannot run here**: it calls the Tauri dialog and fs
 * plugins, which need the desktop shell. This reproduces the four lines
 * of `tauri.ts:60` and nothing else, and the comparison it supports is
 * about the app layer, which is the half that was wrong.
 *
 * `refName` exists so the reference and the name can be made to differ.
 * That is what turns this from a restatement of the implementation into
 * an assertion about the seam: a caller deriving the name from the
 * reference gets a visibly different answer.
 */
function desktopPlatform(absolutePath: string, name?: string): string[] {
  const written: string[] = [];
  io = {
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => ({ ref: absolutePath, name: name ?? basename(absolutePath) }),
    readText: async () => '',
    saveFile: async () => {},
    pickSavePath: async () => null,
    readSnapshot: async () => ({ kind: 'absent' as const }),
    installCloseGuard: async () => {},
    readBinary: async () => Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]),
    writeBinary: async (path: string) => {
      written.push(path);
    },
    entryPresence: async () => 'present' as const,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
  return written;
}

beforeEach(() => {
  clearImages();
  dialogs = [];
});

describe('#145 — the name written into assets/', () => {
  it('the web build writes the sanitized source name, with no prefix', async () => {
    const grant = webPlatform();

    await insertAndSave('notes.md');

    // Read where it lands, not what was computed on the way.
    expect([...(grant.dirs.get('assets') as StubDir).files.keys()]).toEqual([SANITIZED]);
  });

  it('and the document references that same name', async () => {
    webPlatform();

    await insertAndSave('notes.md');

    expect(getAllImages().map((i) => i.relativePath)).toEqual([`assets/${SANITIZED}`]);
  });

  it('the desktop build writes the same name for the same file', async () => {
    // The comparison is the defect. Before this change the two builds
    // disagreed about one file: `picked-Diagrama-finala.png` against
    // `Diagrama-finala.png`. The owner met exactly that by hand.
    const grant = webPlatform();
    await insertAndSave('notes.md');
    const onWeb = [...(grant.dirs.get('assets') as StubDir).files.keys()];

    clearImages();
    const written = desktopPlatform(`/pictures/${SOURCE_NAME}`);
    await insertAndSave('/docs/notes.md');
    const onDesktop = written.map((p) => basename(p));

    expect(onWeb).toEqual([SANITIZED]);
    expect(onDesktop).toEqual(onWeb);
  });

  it('the name is taken from the platform, never derived from the reference', async () => {
    // The seam itself, asserted where the two can be told apart: a
    // reference that looks nothing like the file's name. A caller that
    // went back to `basename(ref)` would write `scratch-4821.tmp`.
    const written = desktopPlatform('/var/tmp/scratch-4821.tmp', SOURCE_NAME);

    await insertAndSave('/docs/notes.md');

    expect(written.map((p) => basename(p))).toEqual([SANITIZED]);
  });
});

describe('#145 — the platform spelling reaches nothing a person reads', () => {
  it('a failed insert names the file, not the reference', async () => {
    webPlatform(SOURCE_NAME, true);

    await insertAndSave('notes.md');

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain(SOURCE_NAME);
    expect(dialogs[0]).not.toContain('picked:');
  });
});

describe('#145 — the pseudo-path registry is unchanged', () => {
  it('a reference is served once and is gone afterwards', async () => {
    // #143 recorded this and it must stay true: `readBinary` deletes the
    // entry after one read, so a stale reference is loud rather than
    // resolving to something else. Nothing may be left behind that a
    // later lookup could match.
    webPlatform();
    const picked = await io.pickFile('Images', ['png']);

    expect(picked).toEqual({ ref: `picked:${SOURCE_NAME}`, name: SOURCE_NAME });
    await expect(io.readBinary(picked?.ref ?? '')).resolves.toBeInstanceOf(Uint8Array);
    await expect(io.readBinary(picked?.ref ?? '')).rejects.toBeInstanceOf(Error);
  });
});
