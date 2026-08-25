import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LINE_CONVENTIONS } from '../formats/line-conventions';
import { saveMarkdown } from '../formats/plain';
import type { DocumentImage } from '../formats/types';
import { bytesEqual, findIdenticalImage, findNameAmong } from './image-dedup';
import { handleImageFile } from './image-handler';
import type { ImageInsertOutcome } from './image-insert-outcome';
import { clearImages, getAllImages, registerImage } from './image-registry';
import { createEditor, type EditorInstance } from './setup';

/** What the fake assets folder holds, name → bytes. */
let filesOnDisk = new Map<string, Uint8Array>();

vi.mock('../platform/detect', () => ({ isTauri: false }));

vi.mock('../platform/index', () => ({
  getPlatformIO: vi.fn(async () => ({
    listDir: vi.fn(async () =>
      Array.from(filesOnDisk.keys(), (name) => ({
        name,
        path: `/doc/assets/${name}`,
        isDirectory: false,
      })),
    ),
    readBinary: vi.fn(async (path: string) => {
      const data = filesOnDisk.get(path.replace('/doc/assets/', ''));
      if (!data) throw new Error(`ENOENT: ${path}`);
      return data;
    }),
  })),
}));

let instance: EditorInstance;
let outcomes: ImageInsertOutcome[] = [];

/** Distinct bytes per seed — two images are identical iff their seeds match. */
function bytesFor(seed: number, length = 64): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (seed * 31 + i) % 251);
}

function makeFile(name: string, seed: number): File {
  const data = bytesFor(seed);
  return {
    size: data.length,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

async function insert(name: string, seed: number, origin: 'clipboard' | 'file' = 'file') {
  await handleImageFile(
    makeFile(name, seed),
    instance.editor,
    () => '/doc/notes.md',
    async () => '/doc/notes.md',
    async () => '/doc/assets',
    async () => true,
    origin,
    // The dedup tests are about what lands in assets/, not about what is
    // said; the outcome is recorded so nothing is dropped (#61).
    (outcome) => outcomes.push(outcome),
  );
}

/** The images a save would write — exactly what saveMarkdown filters to. */
function storedImages(): DocumentImage[] {
  return getAllImages().filter((img) => img.relativePath.startsWith('assets/'));
}

function storedPaths(): string[] {
  return storedImages()
    .map((img) => img.relativePath)
    .sort();
}

/** Every image reference in the document, in order. */
function markdownImagePaths(): string[] {
  return Array.from(instance.getMarkdown().matchAll(/!\[[^\]]*\]\(([^)]+)\)/g), (m) => m[1]);
}

beforeEach(() => {
  filesOnDisk = new Map();
  outcomes = [];
  clearImages();
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
});

describe('two different images that sanitize to the same name (R-C5)', () => {
  // This is the row that makes deduplication dangerous rather than merely
  // useful, and the assertion that has to survive every later refactor of
  // this code: identity is content. A dedup keyed on names destroys one of
  // two different pictures here, silently.
  it('keeps both, the second suffixed, and neither is overwritten', async () => {
    await insert('diagram.png', 1);
    await insert('diagram.png', 2);

    expect(storedPaths()).toEqual(['assets/diagram-2.png', 'assets/diagram.png']);
    expect(markdownImagePaths()).toEqual(['assets/diagram.png', 'assets/diagram-2.png']);

    // Both sets of bytes survive: nothing was written over anything.
    const stored = storedImages();
    expect(stored.map((img) => img.data)).toEqual(
      expect.arrayContaining([bytesFor(1), bytesFor(2)]),
    );
  });

  it('keeps both when only the sanitized forms collide', async () => {
    await insert('Diagramă.png', 1);
    await insert('Diagrama.png', 2);

    expect(storedPaths()).toEqual(['assets/Diagrama-2.png', 'assets/Diagrama.png']);
  });

  it('still refuses to let a differing image take a name held on disk', async () => {
    filesOnDisk.set('diagram.png', bytesFor(9));

    await insert('diagram.png', 1);

    expect(storedPaths()).toEqual(['assets/diagram-2.png']);
    // The file on disk is untouched — inserting writes nothing at all (#14).
    expect(filesOnDisk.get('diagram.png')).toEqual(bytesFor(9));
  });
});

describe('the same image inserted twice (#52)', () => {
  it('stores one copy of a file inserted twice, referenced twice', async () => {
    await insert('diagram.png', 1);
    await insert('diagram.png', 1);

    expect(storedPaths()).toEqual(['assets/diagram.png']);
    expect(markdownImagePaths()).toEqual(['assets/diagram.png', 'assets/diagram.png']);
  });

  it('stores one copy of a screenshot pasted twice, despite the two names', async () => {
    await insert('image.png', 5, 'clipboard');
    await insert('image.png', 5, 'clipboard');

    // Without content comparison these would be notes-01.png and notes-02.png.
    expect(storedPaths()).toEqual(['assets/notes-01.png']);
    expect(markdownImagePaths()).toEqual(['assets/notes-01.png', 'assets/notes-01.png']);
  });

  it('reuses a file already in assets/ from an earlier session', async () => {
    filesOnDisk.set('diagram.png', bytesFor(1));

    await insert('diagram.png', 1);

    expect(storedPaths()).toEqual(['assets/diagram.png']);
    expect(markdownImagePaths()).toEqual(['assets/diagram.png']);
  });

  it('writes the shared image once when the document is saved', async () => {
    await insert('diagram.png', 1);
    await insert('diagram.png', 1);

    const written: string[] = [];
    const io = {
      supportsMultiFile: true,
      // Desktop-shaped: every path carries a directory (#46).
      canWriteCompanions: async () => true,
      saveFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      writeBinary: vi.fn(async (path: string) => {
        written.push(path);
      }),
    };
    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: instance.getMarkdown(),
        images: getAllImages(),
        rootPath: '/doc/notes.md',
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io as never,
    );

    expect(result.assetsError).toBeNull();
    expect(written).toEqual(['/doc/assets/diagram.png']);
  });
});

describe('identity is content, never name', () => {
  it('tells images apart on length before reading a single byte', () => {
    expect(bytesEqual(bytesFor(1, 64), bytesFor(1, 65))).toBe(false);
    expect(bytesEqual(bytesFor(1), bytesFor(1))).toBe(true);
    expect(bytesEqual(bytesFor(1), bytesFor(2))).toBe(false);
  });

  it('finds the registered image holding exactly these bytes', () => {
    const images = [
      { relativePath: 'assets/a.png', data: bytesFor(1), filename: 'a.png' },
      { relativePath: 'assets/b.png', data: bytesFor(2), filename: 'b.png' },
    ];
    expect(findIdenticalImage(bytesFor(2), images)?.relativePath).toBe('assets/b.png');
    expect(findIdenticalImage(bytesFor(3), images)).toBeUndefined();
  });

  it('never reuses an image the user keeps outside assets/', () => {
    const images = [
      { relativePath: '../shared/logo.png', data: bytesFor(1), filename: 'logo.png' },
    ];
    // A save writes only assets/ images, so adopting this path would leave
    // the document pointing at a file AgentEd neither owns nor maintains.
    expect(findIdenticalImage(bytesFor(1), images)).toBeUndefined();
  });

  it('matches names the way Windows would', () => {
    const names = new Set(['Diagram.png', 'notes-01.png']);
    expect(findNameAmong('diagram.png', names)).toBe('Diagram.png');
    expect(findNameAmong('other.png', names)).toBeNull();
  });
});

describe('an image the document references from outside assets/', () => {
  it('is copied into assets/ rather than referenced in place', async () => {
    // What opening a document that references ../shared/logo.png registers.
    const url = 'blob:shared-logo';
    registerImage(url, {
      relativePath: '../shared/logo.png',
      data: bytesFor(7),
      filename: 'logo.png',
    });

    await insert('logo.png', 7);

    // A copy of its own under assets/, not a second reference to the file
    // in ../shared. The exact name is left unasserted: it carries a numeric
    // suffix only because the session already claimed `logo.png` for the
    // outside image, which is a naming rule this issue does not touch.
    const stored = storedPaths();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^assets\//);
    expect(getAllImages()).toHaveLength(2);
  });
});
