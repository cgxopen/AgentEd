import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleImageFile, MAX_IMAGE_SIZE } from './image-handler';
import type { ImageInsertOutcome } from './image-insert-outcome';
import { registerImage } from './image-registry';

/** Names the fake assets folder holds for the test in progress. */
let filesOnDisk: string[] = [];

vi.mock('./image-registry', () => ({
  registerImage: vi.fn(),
  getAllImages: vi.fn(() => []),
}));

vi.mock('../platform/index', () => ({
  getPlatformIO: vi.fn(async () => ({
    listDir: vi.fn(async () =>
      filesOnDisk.map((name) => ({ name, path: `/doc/assets/${name}`, isDirectory: false })),
    ),
  })),
}));

vi.mock('../platform/detect', () => ({
  isTauri: false,
}));

/** Every outcome the insert under test reported (#61). */
let outcomes: ImageInsertOutcome[] = [];
const record = (outcome: ImageInsertOutcome) => {
  outcomes.push(outcome);
};

function makeStubEditor() {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  const chain = vi.fn(() => ({ focus }));
  return { chain } as unknown as Editor;
}

function makeFile(size: number, type = 'image/png', name = 'big.png'): File {
  return {
    size,
    type,
    name,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as File;
}

describe('handleImageFile — M5 size cap', () => {
  beforeEach(() => {
    outcomes = [];
  });

  it('bails out before any I/O when file exceeds MAX_IMAGE_SIZE', async () => {
    const editor = makeStubEditor();
    const getFilePath = vi.fn(() => '/doc/notes.md');
    const requestSaveAs = vi.fn(async () => '/doc/notes.md');
    const ensureAssetsDir = vi.fn(async () => '/doc/assets');

    const oversized = makeFile(MAX_IMAGE_SIZE + 1);
    await handleImageFile(
      oversized,
      editor,
      getFilePath,
      requestSaveAs,
      ensureAssetsDir,
      async () => true,
      'file',
      record,
    );

    expect(ensureAssetsDir).not.toHaveBeenCalled();
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    // The refusal is a reported fact, not a message written here (#61).
    expect(outcomes).toEqual([
      {
        kind: 'refused',
        reason: 'too-large',
        sizeBytes: MAX_IMAGE_SIZE + 1,
        limitBytes: MAX_IMAGE_SIZE,
      },
    ]);
  });

  it('proceeds past the size guard when file fits under the cap', async () => {
    const editor = makeStubEditor();
    const getFilePath = vi.fn(() => '/doc/notes.md');
    const requestSaveAs = vi.fn(async () => '/doc/notes.md');
    const ensureAssetsDir = vi.fn(async () => '/doc/assets');

    const ok = makeFile(1024);
    await handleImageFile(
      ok,
      editor,
      getFilePath,
      requestSaveAs,
      ensureAssetsDir,
      async () => true,
      'file',
      record,
    );

    expect(ensureAssetsDir).toHaveBeenCalledTimes(1);
    expect(ok.arrayBuffer).toHaveBeenCalledTimes(1);
  });
});

describe('handleImageFile — naming (R-C5)', () => {
  const requestSaveAs = vi.fn(async () => '/doc/notes.md');
  const ensureAssetsDir = vi.fn(async () => '/doc/assets');

  beforeEach(() => {
    filesOnDisk = [];
    outcomes = [];
    vi.mocked(registerImage).mockClear();
  });

  /** Relative path the insert registered for the image. */
  async function insert(name: string, origin: 'clipboard' | 'file', documentPath: string) {
    await handleImageFile(
      makeFile(1024, 'image/png', name),
      makeStubEditor(),
      () => documentPath,
      requestSaveAs,
      ensureAssetsDir,
      async () => true,
      origin,
      record,
    );
    return vi.mocked(registerImage).mock.calls.at(-1)?.[1].relativePath;
  }

  it('names a pasted screenshot after the document', async () => {
    expect(await insert('image.png', 'clipboard', '/doc/Raport lunar.md')).toBe(
      'assets/raport-lunar-01.png',
    );
  });

  it('continues the sequence past what the folder already holds', async () => {
    filesOnDisk = ['raport-lunar-01.png', 'raport-lunar-02.png'];
    expect(await insert('image.png', 'clipboard', '/doc/Raport lunar.md')).toBe(
      'assets/raport-lunar-03.png',
    );
  });

  it('keeps the name of a file the user picked, sanitized', async () => {
    expect(await insert('Diagramă finală.PNG', 'file', '/doc/notes.md')).toBe(
      'assets/Diagrama-finala.png',
    );
  });

  it('never overwrites a file already in the folder', async () => {
    filesOnDisk = ['diagram.png'];
    expect(await insert('diagram.png', 'file', '/doc/notes.md')).toBe('assets/diagram-2.png');
  });

  it('produces no timestamp or random suffix', async () => {
    const path = await insert('image.png', 'clipboard', '/doc/notes.md');
    expect(path).toBe('assets/notes-01.png');
  });
});
