/**
 * A document whose images are on disk, through the route the application
 * actually runs (#27).
 *
 * ── The gap this file exists to hold ──
 *
 * `prepareMarkdownForDisplay` rewrites every image reference it can resolve
 * **in the raw markdown, before the parser sees it**: `assets/b.png` becomes a
 * `blob:` URL so the picture can be drawn, and `image-registry.ts` is what maps
 * that blob back on the way out. Every other guard in this repository skips
 * that pass — `roundtrip.test.ts` hands `setMarkdown` the loaded body directly,
 * and the repository's own documents reference only `https://` badges, which
 * the loader leaves alone by design.
 *
 * So no test looked at a document with a local image through the whole route,
 * and #27 shipped a defect into the owner's hands because of it: the HTML
 * spelling of an image was captured **after** the rewrite, so the bytes carried
 * were `<img src="blob:http://localhost:1420/…">` and that is what a save wrote
 * into the user's file. The image reference was destroyed — 52 bytes longer,
 * and the picture gone the next time the document was opened.
 *
 * The repair is that the serializer maps the address back for the HTML form
 * exactly as it always did for the markdown form. What that costs is nothing,
 * because `setTagAttribute` returns its input when the value is unchanged: an
 * image the loader never touched keeps its bytes to the character.
 *
 * These tests are the level that can say so. They are deliberately not in
 * `roundtrip.test.ts`: that file's harness is the save assembly without the
 * display pass, and adding a second harness to it would blur what its rows
 * mean.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildBundle } from '../app/bundle';
import { AppState } from '../app/state';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { prepareMarkdownForDisplay } from './image-loader';

const DOCUMENT_PATH = '/doc/notes.md';

/** One pixel of PNG, enough for the loader to have something to read. */
const PIXEL = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
  clearImages();
});

/**
 * A disk holding the document and the images beside it. `readBinary` answers
 * for anything under `assets/`, which is what makes the loader rewrite the
 * references rather than leave them alone — the branch the defect lived in.
 */
function diskWith(text: string): { io: PlatformIO; disk: Map<string, string> } {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  return {
    disk,
    io: {
      supportsMultiFile: true,
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
        if (!path.includes('assets/')) throw new Error(`no such image: ${path}`);
        return PIXEL;
      },
      writeBinary: async () => {},
      entryPresence: async () => 'absent' as const,
      listDir: async (): Promise<FileEntry[]> => [],
      mkdir: async () => {},
      remove: async () => {},
      openWithSystem: async () => {},
    },
  };
}

/**
 * Open a file, resolve its images for display, change nothing, save — and
 * return the bytes that reached the disk. The whole route, display pass
 * included, which is the one thing every other guard leaves out.
 */
async function openAndSaveThroughDisplay(text: string): Promise<string> {
  const { io } = diskWith(text);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const displayBody = await prepareMarkdownForDisplay(loaded.bundle, io);

  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(displayBody);

  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.bundle.frontmatterRaw;
  state.lineConventions = loaded.bundle.lineConventions;

  const written = await saveMarkdown(buildBundle(state, instance.getMarkdown), io);
  return written.writtenText;
}

describe('the display pass rewrites the address, and the save puts it back', () => {
  it('resolves the reference on the way in, so the defect has somewhere to happen', async () => {
    // The premise, asserted rather than assumed: without this the tests below
    // would pass against a loader that had quietly stopped rewriting anything.
    const { io } = diskWith('');
    const loaded = await loadMarkdown(DOCUMENT_PATH, {
      ...io,
      readText: async () => '<img src="assets/b.png" alt="chart" width="400">\n',
    });
    const displayBody = await prepareMarkdownForDisplay(loaded.bundle, io);
    expect(displayBody).toContain('blob:');
    expect(displayBody).not.toContain('assets/b.png');
  });

  it.each([
    ['an html image with a width', '<img src="assets/b.png" alt="chart" width="400">\n'],
    ['an html image with no size', '<img src="assets/b.png" alt="chart">\n'],
    ['an html image in single quotes', "<img src='assets/b.png' alt='chart' width='400'>\n"],
    ['an html image carrying a style', '<img src="assets/b.png" alt="c" width="9" style="x">\n'],
    ['a markdown image', '![chart](assets/b.png)\n'],
    [
      'the fixture the owner tests with',
      '# Resize test\n\n' +
        'A markdown image, 320 by 160:\n\n' +
        '![diagram](assets/a.png)\n\n' +
        'An html image the file already sized, 240 by 120 natural:\n\n' +
        '<img src="assets/b.png" alt="chart" width="400">\n\n' +
        'A paragraph with an inline image ![icon](assets/c.png) sitting in the middle of it.\n',
    ],
  ])('%s survives the whole route byte for byte', async (_label, text) => {
    expect(await openAndSaveThroughDisplay(text)).toBe(text);
  });

  it('never writes a blob address into the file', async () => {
    // The failure named directly rather than only through byte equality: this
    // is what the owner found in the file, and a byte comparison that started
    // failing for some other reason would not say which.
    const written = await openAndSaveThroughDisplay(
      '<img src="assets/b.png" alt="chart" width="400">\n',
    );
    expect(written).not.toContain('blob:');
    expect(written).toContain('assets/b.png');
  });

  it('an image the loader could not resolve keeps the address the file wrote', async () => {
    // No registry entry, so nothing maps back — and the bytes must still be the
    // file's own rather than an empty address.
    const text = '<img src="pictures/missing.png" alt="m" width="120">\n';
    expect(await openAndSaveThroughDisplay(text)).toBe(text);
  });

  it('an unquoted html image is left alone by the loader and still round-trips', async () => {
    // The loader only rewrites a *quoted* src, so this one is never resolved —
    // its picture does not display, which is older than #27 and not repaired
    // here. What must hold is that its bytes are not damaged.
    const text = '<img src=assets/b.png alt=chart width=400>\n';
    expect(await openAndSaveThroughDisplay(text)).toBe(text);
  });
});
