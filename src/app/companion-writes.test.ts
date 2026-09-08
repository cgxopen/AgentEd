/**
 * Issue #148 — a document saved outside the granted folder had its
 * images written into the granted folder, and referenced them beside
 * itself.
 *
 * `canWriteCompanions` answered about the **session** — is any folder
 * granted — and ignored the path it was handed. That was right while
 * every web document lived at the grant root, which is what #147 stopped
 * being true. A Save As into a folder the grant cannot reach leaves the
 * document there and the grant here; `assets/` is built from `dirname`
 * of a bare name, so it resolved against the grant. Measured after #147,
 * grant on `A` and the document saved into `B`:
 *
 * ```
 * canWriteCompanions  = true
 * resolveAssetsDir    = { dir: "assets", exists: false }
 * saveMarkdown        -> created A/assets/, wrote A/assets/x.png
 * ```
 *
 * The document was saved correctly and the picture it pointed at was in
 * another tree, so the reference resolved to nothing — for every reader,
 * including AgentEd reopening the file. **R-C5** puts `assets/` next to
 * the file and rests on that relative path being portable.
 *
 * The owner's decision, taken before the work: **refuse and say so.** Not
 * acquire a second folder — that is a third picker in a flow that already
 * has two, and asking again about access already granted is what #51
 * called the application forgetting what it was told.
 *
 * **`dirname` cannot tell the states apart and the registration can.**
 * Measured over the four states this platform has:
 *
 * | state | path answered | `dirname` | registered |
 * | --- | --- | --- | --- |
 * | subfolder of the grant | `doc/report.md` | `doc` | no |
 * | at the grant root | `report.md` | `""` | no |
 * | outside the grant | `report.md` | `""` | **yes** |
 * | no grant at all | `report.md` | `""` | **yes** |
 *
 * Three of four answer an empty parent, so an empty parent means
 * nothing. A path is registered exactly when the granted folder could
 * not name the file, which is the question being asked.
 *
 * **The two states that must keep working are pinned here as hard as the
 * one being fixed** — a document in a subfolder still gets `assets/`
 * beside it, which is #147's manual pass turned into a test, and so does
 * one at the grant root.
 *
 * The message is read **where the user reads it**: assembled, out of the
 * toast in the document, not as a string a fake reporter kept. That is
 * the #134 lesson and it cost a merge to learn.
 */
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, getAllImages } from '../editor/image-registry';
import { DEFAULT_LINE_CONVENTIONS } from '../formats/line-conventions';
import { saveMarkdown } from '../formats/plain';
import { WebIO } from '../platform/web';
import { resolveAssetsDir } from './assets-dir';
import { createImageInsertReporter, imageInsertUnavailableMessage } from './image-insert-report';
import { insertMedia } from './media-picker';
import { AppState } from './state';

const IMAGE_NAME = 'diagram.png';

let io: WebIO;

vi.mock('../platform/detect', () => ({ isTauri: false }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn(async () => 'create') }));

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

function stubEditor(): Editor {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  return { chain: vi.fn(() => ({ focus })) } as unknown as Editor;
}

/** What the user can actually read on screen right now. */
function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('#toast-container .toast')).map(
    (el) => el.textContent ?? '',
  );
}

/** Every folder and file the granted tree holds, as flat paths. */
function contentsOf(dir: StubDir, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of dir.files.keys()) out.push(`${prefix}${name}`);
  for (const [name, sub] of dir.dirs) {
    out.push(`${prefix}${name}/`);
    out.push(...contentsOf(sub, `${prefix}${name}/`));
  }
  return out.sort();
}

type Where = 'subfolder' | 'grant-root' | 'outside' | 'no-grant';

interface Scenario {
  state: AppState;
  /** The folder the user granted, whether or not the document is in it. */
  grant: StubDir;
  /** The tree the document was saved into, when it is not the grant. */
  elsewhere: StubDir;
}

/**
 * Build one of the four states by driving the real `pickSavePath`, so
 * the path the application holds is the one this platform answered
 * rather than one the test wrote down.
 */
async function scenario(where: Where): Promise<Scenario> {
  const grant = dirHandle('A', { doc: { 'report.md': '' }, 'report.md': '' });
  const elsewhere = dirHandle('B', { 'report.md': '' });

  const destination =
    where === 'subfolder'
      ? (grant.dirs.get('doc')?.files.get('report.md') as StubFile)
      : where === 'grant-root'
        ? (grant.files.get('report.md') as StubFile)
        : (elsewhere.files.get('report.md') as StubFile);

  io = new WebIO();
  if (where !== 'no-grant') {
    (io as unknown as { dirHandle: unknown }).dirHandle = grant;
  }
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(
    async () => destination,
  );
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => {
    throw new DOMException('stub: cancelled', 'AbortError');
  });

  const state = new AppState();
  state.filePath = await io.pickSavePath();

  const source = fileHandle(IMAGE_NAME, 'IMAGE BYTES');
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(async () => [
    source,
  ]);

  return { state, grant, elsewhere };
}

/** Insert one image through the menu, with the real reporter wired as `main.ts` wires it. */
async function insert(s: Scenario): Promise<void> {
  await insertMedia({
    state: s.state,
    editor: stubEditor(),
    requestSaveAs: async () => s.state.filePath,
    reporter: { dialog: vi.fn(async () => {}) } as never,
    report: createImageInsertReporter(s.state),
  });
}

beforeEach(() => {
  clearImages();
  // The toasts, not their container: `showToast` caches the container
  // node, so removing it leaves later messages going into something
  // detached from the document — where a test reading the document finds
  // nothing and passes for the wrong reason.
  for (const toast of document.querySelectorAll('#toast-container .toast')) toast.remove();
});

describe('#148 — a document the granted folder cannot reach', () => {
  it('the insert is refused and says so, once', async () => {
    const s = await scenario('outside');

    await insert(s);

    expect(toastTexts()).toEqual([imageInsertUnavailableMessage('no-folder-access')]);
  });

  it('and nothing is created in the granted folder', async () => {
    // The acceptance criterion. Before this, `A/assets/` was created and
    // `A/assets/diagram.png` written, while the document sat in `B`.
    const s = await scenario('outside');
    const before = contentsOf(s.grant);

    await insert(s);

    expect(contentsOf(s.grant)).toEqual(before);
    expect(getAllImages()).toEqual([]);
  });

  it('and the save cannot write them there either', async () => {
    // The other half of the same state: an image inserted while the
    // document was reachable, then a Save As that moves it out of reach.
    // The document still saves; its images are reported rather than
    // written into a folder the user did not mean.
    const s = await scenario('outside');
    const before = contentsOf(s.grant);

    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: `![](assets/${IMAGE_NAME})`,
        images: [
          {
            relativePath: `assets/${IMAGE_NAME}`,
            data: Uint8Array.from([1, 2, 3]),
            filename: IMAGE_NAME,
          },
        ],
        rootPath: s.state.filePath ?? '',
        byteOrderMark: false,
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );

    expect(result.assetsError).toBeInstanceOf(Error);
    expect(contentsOf(s.grant)).toEqual(before);
  });
});

describe('#148 — the states that must keep working', () => {
  it('a document in a subfolder of the grant gets assets/ beside it', async () => {
    // #147's manual pass, turned into a test.
    const s = await scenario('subfolder');

    await insert(s);

    expect(toastTexts()).not.toContain(imageInsertUnavailableMessage('no-folder-access'));
    expect(getAllImages().map((i) => i.relativePath)).toEqual([`assets/${IMAGE_NAME}`]);
    await expect(resolveAssetsDir(s.state.filePath ?? '', io)).resolves.toEqual({
      dir: 'doc/assets',
      exists: false,
    });
  });

  it('a document at the grant root does too, though its parent is empty', async () => {
    // The state `dirname` cannot tell from the broken one: the path is a
    // bare name here as well, and this document is perfectly reachable.
    const s = await scenario('grant-root');

    await insert(s);

    expect(getAllImages().map((i) => i.relativePath)).toEqual([`assets/${IMAGE_NAME}`]);
    await expect(resolveAssetsDir(s.state.filePath ?? '', io)).resolves.toEqual({
      dir: 'assets',
      exists: false,
    });
  });
});

describe('#148 — the state that was already right stays right', () => {
  it('no grant at all is refused with the same sentence, as it was before', async () => {
    // The #46 behaviour, unchanged. One sentence covers both states
    // because the fact they share — no access to this document's folder —
    // is the one thing that is true of each.
    const s = await scenario('no-grant');

    await insert(s);

    expect(toastTexts()).toEqual([imageInsertUnavailableMessage('no-folder-access')]);
    expect(getAllImages()).toEqual([]);
  });
});

describe('#148 — what the sentence says', () => {
  it('names the document folder, names Save As, and says the image was not added', async () => {
    // Read where the user reads it, assembled — not the constant.
    const s = await scenario('outside');

    await insert(s);
    const shown = toastTexts()[0] ?? '';

    expect(shown).toContain('the folder this document is in');
    expect(shown).toContain('Save As');
    expect(shown).toContain('wasn’t added');
    // It asserts no cause it cannot tell apart: two states reach this
    // sentence and neither is named (#58, #127).
    expect(shown).not.toContain('granted');
    expect(shown).not.toContain('permission');
  });
});
