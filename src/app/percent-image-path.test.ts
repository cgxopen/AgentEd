/**
 * An image referenced with a percent escape draws, is reused, and is saved
 * back where it was found (#454).
 *
 * `![diagram](assets/my%20diagram.png)` is the markdown spelling of a file
 * named `my diagram.png`. The loader handed the address to the disk as it was
 * written, so it asked for `assets/my%20diagram.png`, which does not exist, and
 * the picture drew as missing. A second insert of the same picture then wrote
 * a second file, because the document had never loaded the first.
 *
 * These drive the fixture of the #453 manual pass through the whole route a
 * document takes: load, the display pass, the editor, an insert and a save.
 * What the disk is asked for is recorded, so a save that wrote the bytes to a
 * new file named `my%20diagram.png` is seen as well as one that drew nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, getAllImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { buildDocument } from './editor-document';
import { prepareMarkdownForDisplay } from './image-loader';
import { AppState } from './state';

const FOLDER = 'C:/Users/vasil/Downloads/agented-453-test/New folder';
const DOCUMENT_PATH = `${FOLDER}/notes.md`;
const IMAGE_PATH = `${FOLDER}/assets/my diagram.png`;

/** The fixture of the #453 manual pass, 150 bytes. */
const FIXTURE =
  '# Housekeeping pass\n\n' +
  'A paragraph with [a link](https://example.com) inside it.\n\n' +
  '![diagram](assets/my%20diagram.png)\n\n' +
  '```\ncode here\n```\n\n' +
  '---\n\n' +
  'The end.\n';

const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** What the disk holds, and every binary path it was asked to read or write. */
let disk: Map<string, string>;
let pictures: Map<string, Uint8Array>;
let binaryReads: string[];
let binaryWrites: string[];

function fakeIO(): PlatformIO {
  return {
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async (path: string) => {
      const found = disk.get(path);
      if (found === undefined) throw new Error(`no such file: ${path}`);
      return found;
    },
    saveFile: async (path: string, content: string) => {
      disk.set(path, content);
    },
    readSnapshot: async (path: string): Promise<FileSnapshot> => {
      const found = disk.get(path);
      return found === undefined ? { kind: 'absent' } : { kind: 'file', text: found };
    },
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async (path: string) => {
      binaryReads.push(path);
      const found = pictures.get(path);
      if (!found) throw new Error(`no such image: ${path}`);
      return found;
    },
    writeBinary: async (path: string, data: Uint8Array) => {
      binaryWrites.push(path);
      pictures.set(path, data);
    },
    entryPresence: async () => 'present' as const,
    listDir: async (): Promise<FileEntry[]> =>
      Array.from(pictures.keys(), (path) => ({
        name: path.slice(path.lastIndexOf('/') + 1),
        path,
        isDirectory: false,
      })),
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => fakeIO()) }));

let instance: EditorInstance | null = null;
let state: AppState;

beforeEach(() => {
  disk = new Map([[DOCUMENT_PATH, FIXTURE]]);
  pictures = new Map([[IMAGE_PATH, PICTURE]]);
  binaryReads = [];
  binaryWrites = [];
  clearImages();
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
  clearImages();
});

/** Open the fixture the way a document is opened, display pass included. */
async function open(): Promise<{ displayBody: string; editor: EditorInstance }> {
  const io = fakeIO();
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const displayBody = await prepareMarkdownForDisplay(loaded.document, io);
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(displayBody);
  state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  return { displayBody, editor: instance };
}

async function save(editor: EditorInstance): Promise<string> {
  const result = await saveMarkdown(buildDocument(state, editor.getMarkdown), fakeIO());
  expect(result.assetsError).toBeNull();
  return result.writtenText;
}

async function insertTheSamePicture(editor: EditorInstance): Promise<void> {
  const { handleImageFile } = await import('../editor/image-handler');
  const file = {
    size: PICTURE.length,
    type: 'image/png',
    name: 'my diagram.png',
    arrayBuffer: async () => PICTURE.slice().buffer,
  } as unknown as File;
  editor.editor.commands.setTextSelection(editor.editor.state.doc.content.size - 1);
  await handleImageFile(
    file,
    editor.editor,
    () => DOCUMENT_PATH,
    async () => DOCUMENT_PATH,
    async () => `${FOLDER}/assets`,
    async () => true,
    'file',
    () => {},
  );
}

const references = (markdown: string): string[] =>
  Array.from(markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g), (m) => m[1]);

describe('an image referenced with %20 (#454)', () => {
  it('draws: the disk is asked for the file with a space, and the address is resolved', async () => {
    const { displayBody } = await open();
    expect(binaryReads).toEqual([IMAGE_PATH]);
    expect(displayBody).not.toContain('assets/my%20diagram.png');
    expect(getAllImages().map((image) => image.relativePath)).toEqual(['assets/my%20diagram.png']);
  });

  it('is reused by a second insert of the same picture, and no second file is written', async () => {
    const { editor } = await open();
    await insertTheSamePicture(editor);
    const written = await save(editor);

    expect(references(written)).toEqual(['assets/my%20diagram.png', 'assets/my%20diagram.png']);
    expect(Array.from(pictures.keys())).toEqual([IMAGE_PATH]);
  });

  it('is saved back byte for byte, the %20 kept, and its bytes go to the file they came from', async () => {
    const { editor } = await open();
    // The premise: with the image never loaded there is nothing to write, and
    // the rows below would hold on the build that drew nothing.
    expect(getAllImages()).toHaveLength(1);
    expect(await save(editor)).toBe(FIXTURE);
    expect(disk.get(DOCUMENT_PATH)).toBe(FIXTURE);
    // A save writes every image it holds under `assets/`; this one must land
    // on the file it was read from, not on a new one named with the escape.
    expect(binaryWrites.every((path) => path === IMAGE_PATH)).toBe(true);
    expect(Array.from(pictures.keys())).toEqual([IMAGE_PATH]);
  });
});
