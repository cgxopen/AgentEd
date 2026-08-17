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

function imageFile(name: string): File {
  return {
    size: 1024,
    type: 'image/png',
    name,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as File;
}

/**
 * Paste an image into a never-saved document, exactly as `main.ts` wires
 * the flow: no path yet, so `requestSaveAs` settles one (writing nothing,
 * per #11), then the assets folder is confirmed.
 */
async function pasteIntoFreshDocument(state: AppState) {
  const { handleImageFile } = await import('../editor/image-handler');
  await handleImageFile(
    imageFile('diagram.png'),
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

  it('touches nothing on disk at insert time, however the user answers', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    await pasteIntoFreshDocument(new AppState());

    expect(calls.filter((c) => c.startsWith('mkdir'))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('writeBinary'))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('saveFile'))).toEqual([]);
  });

  it('leaves no assets/ behind when the document is discarded', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const state = new AppState();
    await pasteIntoFreshDocument(state);

    // Discard: the document is dropped without ever being saved.
    clearImages();
    state.resetDocument();

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
