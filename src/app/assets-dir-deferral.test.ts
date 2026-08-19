/**
 * Issue #14 — inserting an image into a document that never reaches disk
 * must leave nothing behind.
 *
 * The insert path and the save path are wired together here exactly as
 * `main.ts` wires them, behind a `PlatformIO` that records every call, so
 * the test measures what actually touches the filesystem rather than
 * asserting on an intermediate function. That is the whole claim of the
 * fix: at insert time the recorder sees no `mkdir` and no `writeBinary`.
 */
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, getAllImages } from '../editor/image-registry';
import { saveMarkdown } from '../formats/plain';
import type { FileEntry, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { confirmAssetsDir } from './assets-dir';
import { AppState } from './state';

/** Every filesystem call the flow made, in order. */
let calls: string[] = [];

const io: PlatformIO = {
  supportsMultiFile: true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async () => '',
  saveFile: async (path: string) => {
    calls.push(`saveFile ${path}`);
  },
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async (path: string) => {
    calls.push(`writeBinary ${path}`);
  },
  exists: async () => false,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async (path: string) => {
    calls.push(`mkdir ${path}`);
  },
  remove: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/detect', () => ({ isTauri: true }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));

function stubEditor(): Editor {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  return { chain: vi.fn(() => ({ focus })) } as unknown as Editor;
}

/**
 * `seed` makes each image genuinely distinct. Identical bytes are one
 * picture and are stored once (#52), so a fixture that repeated itself
 * would prove nothing about a *second* insert.
 */
function imageFile(name: string, seed = 1): File {
  const data = Uint8Array.from({ length: 8 }, (_, i) => seed * 16 + i);
  return {
    size: data.length,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

/**
 * Paste an image into a never-saved document, exactly as `main.ts` wires
 * the flow: no path yet, so `requestSaveAs` settles one (writing nothing,
 * per #11), then the assets folder is confirmed.
 */
async function pasteIntoFreshDocument(state: AppState, seed = 1) {
  const { handleImageFile } = await import('../editor/image-handler');
  await handleImageFile(
    imageFile('diagram.png', seed),
    stubEditor(),
    () => state.filePath,
    async () => {
      state.filePath = '/doc/notes.md';
      return state.filePath;
    },
    async () => {
      const path = state.filePath;
      if (!path) return null;
      return confirmAssetsDir(path, io, state);
    },
    'file',
  );
}

describe('#14 — an image in a document that was never saved', () => {
  beforeEach(() => {
    calls = [];
    clearImages();
    vi.mocked(showConfirmDialog).mockReset();
  });

  it('touches nothing on disk from insert through discard', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const state = new AppState();

    await pasteIntoFreshDocument(state);
    // Discard: the document is dropped without ever being saved. Folded
    // into one test on purpose — asserted separately, the post-discard
    // half could only repeat an assertion that already held, which is a
    // green tick standing in for coverage it does not have.
    clearImages();
    state.resetDocument();

    expect(calls).toEqual([]);
  });

  it('asks once however many images go in before the first save', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const state = new AppState();

    await pasteIntoFreshDocument(state, 1);
    await pasteIntoFreshDocument(state, 2);
    await pasteIntoFreshDocument(state, 3);

    // The folder is not created until the save, so the third insert
    // still finds it absent — the consent has to be remembered.
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(getAllImages()).toHaveLength(3);
    expect(calls).toEqual([]);
  });

  it('still asks before accepting the image, and cancelling cancels the insert', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    await pasteIntoFreshDocument(new AppState());

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(getAllImages()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('creates assets/ and writes the image on the first real save', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const state = new AppState();
    await pasteIntoFreshDocument(state);
    expect(getAllImages()).toHaveLength(1);

    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![diagram](assets/diagram.png)\n',
        images: getAllImages(),
        rootPath: state.filePath!,
      },
      io,
    );

    expect(result.assetsError).toBeNull();
    expect(calls).toEqual([
      'saveFile /doc/notes.md',
      'mkdir /doc/assets',
      'writeBinary /doc/assets/diagram.png',
    ]);
  });

  it('names the image the way R-C5 asks, unchanged by the deferral', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    await pasteIntoFreshDocument(new AppState());

    expect(getAllImages()[0]?.relativePath).toBe('assets/diagram.png');
  });
});
