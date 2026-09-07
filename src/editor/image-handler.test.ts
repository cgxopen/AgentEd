import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleImageFile, MAX_IMAGE_SIZE } from './image-handler';
import type { ImageInsertOutcome } from './image-insert-outcome';
import { registerImage } from './image-registry';

/** Names the fake assets folder holds for the test in progress. */
let filesOnDisk: string[] = [];

// `displayMimeFromName` is taken from the real module rather than doubled
// (#248). It is a pure lookup with no state to stand in the way, and the
// point of the assertions below is the type an insert actually produces —
// a stub here would let the table and the call site disagree silently.
vi.mock('./image-registry', async (importOriginal) => ({
  registerImage: vi.fn(),
  getAllImages: vi.fn(() => []),
  displayMimeFromName: (await importOriginal<typeof import('./image-registry')>())
    .displayMimeFromName,
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

/**
 * Every blob the insert route built, so its media type can be read (#248).
 *
 * Installed **once**, over the pristine `createObjectURL`. Re-spying inside a
 * row of `it.each` binds the fallthrough to the previous spy, and the second
 * row then recurses until the stack ends — met while writing these rows.
 */
const blobsBuilt: Blob[] = [];
const pristineCreateObjectURL = URL.createObjectURL.bind(URL);
vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
  blobsBuilt.push(b as Blob);
  return pristineCreateObjectURL(b as Blob);
});

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

/**
 * Issue #248 — the type the display blob is given on the way in.
 *
 * **Measured before it was built**: the insert route builds its blob from the
 * bytes, so the media type the picker put on the `File` was thrown away and
 * an inserted svg drew as the placeholder immediately — not, as the issue
 * first read it, only after a reopen. Paste and drop reach the same line, so
 * all three gestures were the same defect.
 *
 * **The name is the source, not the `File`.** It is the name the image will
 * carry in `assets/` and therefore the name the reference will resolve
 * against on the next open, so the type here and the type the display route
 * gives it later are the same answer to the same question. A `File` handed in
 * with no type at all — which a drop can be — lands on it just the same.
 *
 * As on the display route, whether a browser *draws* the result is not
 * observable in this suite; what is asserted is the type, and the manual pass
 * is where the drawing is verified.
 */
describe('#248 — an inserted image carries a media type', () => {
  beforeEach(() => {
    outcomes = [];
    filesOnDisk = [];
  });

  it.each([
    ['an svg, the kind no browser sniffs', 'logo.svg', 'image/svg+xml'],
    ['a png, which was never broken', 'shot.png', 'image/png'],
    ['a jpg, spelled with the short extension', 'photo.jpg', 'image/jpeg'],
  ])('%s', async (_label, name, expected) => {
    blobsBuilt.length = 0;

    // Deliberately handed in with **no** type, so nothing but the name can
    // be answering. A drop carries exactly this shape.
    await handleImageFile(
      makeFile(64, '', name),
      makeStubEditor(),
      () => '/doc/notes.md',
      async () => '/doc/notes.md',
      async () => '/doc/assets',
      async () => true,
      'file',
      record,
    );

    expect(outcomes).toContainEqual({ kind: 'inserted' });
    expect(blobsBuilt).toHaveLength(1);
    expect(blobsBuilt[0].type).toBe(expected);
  });
});
