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
 * the blob address and that is what a save wrote into the user's file. The
 * image reference was destroyed, and the picture would have been gone the next
 * time the document was opened.
 *
 * Measured on the Windows build, which is the only place it could be — one line
 * of the owner's fixture, before and after an unedited save:
 *
 * ```
 * <img src="assets/b.png" alt="chart" width="400">
 * <img src="blob:http://tauri.localhost/487332f4-…-305fcf484e3e" alt="chart" width="400">
 * ```
 *
 * Twelve characters of address became sixty-four, and the document went from
 * 276 bytes to 328 — the difference is the address and nothing else, which is
 * what said the rest of the change was sound. The blob form is the runtime's
 * rather than this repository's: WebView2 under Tauri spells it as above, and
 * `happy-dom` spells it `blob:nodedata:…`, so nothing here matches on its shape.
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
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { clearImages, getAllImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { prepareMarkdownForDisplay } from './image-loader';

const DOCUMENT_PATH = '/doc/notes.md';

/** What the disk beside the document actually holds, by absolute path. */
const ON_DISK = new Set(['/doc/assets/a.png', '/doc/assets/b.png', '/doc/assets/c.png']);

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
      // **Exact paths, not a prefix test.** This used to answer for anything
      // holding `assets/`, which made it answer for
      // `/doc/assets/a.png "The architecture diagram"` — the malformed path the
      // loader was building before #230 repaired the destination split. So the
      // fake resolved a reference the real filesystem never would, and the
      // tests below passed against the very defect they were written for. The
      // reversal is what found it. A disk answers for the files it has.
      readBinary: async (path: string) => {
        if (!ON_DISK.has(path)) throw new Error(`no such image: ${path}`);
        return PIXEL;
      },
      writeBinary: async () => {},
      entryPresence: async () => 'absent' as const,
      listDir: async (): Promise<FileEntry[]> => [],
      mkdir: async () => {},
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
  const displayBody = await prepareMarkdownForDisplay(loaded.document, io);

  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(displayBody);

  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;

  const written = await saveMarkdown(buildDocument(state, instance.getMarkdown), io);
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
    const displayBody = await prepareMarkdownForDisplay(loaded.document, io);
    expect(displayBody).toContain('blob:');
    expect(displayBody).not.toContain('assets/b.png');
  });

  it.each([
    ['an html image with a width', '<img src="assets/b.png" alt="chart" width="400">\n'],
    ['an html image with no size', '<img src="assets/b.png" alt="chart">\n'],
    ['an html image in single quotes', "<img src='assets/b.png' alt='chart' width='400'>\n"],
    ['an html image carrying a style', '<img src="assets/b.png" alt="c" width="9" style="x">\n'],
    ['a markdown image', '![chart](assets/b.png)\n'],
    ['a markdown image with a title', '![diagram](assets/a.png "The architecture diagram")\n'],
    [
      'a document mixing a titled image, an untitled one and an html one',
      '![a](assets/a.png "first")\n\n![b](assets/b.png)\n\n' +
        '<img src="assets/c.png" alt="c" title="third">\n',
    ],
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

  it.each([
    ['a double-quoted title', '![diagram](assets/a.png "The architecture diagram")\n'],
    ['a single-quoted title', "![diagram](assets/a.png 'The architecture diagram')\n"],
    ['a parenthesised title', '![diagram](assets/a.png (The architecture diagram))\n'],
    ['a title holding an escaped quote', '![d](assets/a.png "say \\" now")\n'],
    ['a title holding a closing parenthesis', '![d](assets/a.png "a ) c")\n'],
    ['spaces around the title', '![d](assets/a.png   "spaced"  )\n'],
  ])('an image with %s still resolves for display', async (_label, text) => {
    // **What the owner saw, and what no byte comparison could have said.** The
    // reference resolves or it does not, and a document whose bytes survive a
    // save can still be one where the picture never drew: `MD_IMG_RE` handed
    // the file read `assets/a.png "The architecture diagram"` as a path,
    // because its destination group ran to the closing bracket and swallowed
    // the title. It failed, the reference was left alone, and the image was a
    // broken icon on screen.
    //
    // It was broken before #230 too and healed itself, which is why it went
    // unmet: the title was deleted on the first save, so the next open
    // resolved. Making the title survive would have made the breakage
    // permanent — so it is repaired in the change that would have caused it.
    const { io } = diskWith(text);
    const loaded = await loadMarkdown(DOCUMENT_PATH, io);
    const displayBody = await prepareMarkdownForDisplay(loaded.document, io);
    expect(displayBody).toContain('blob:');
    expect(displayBody).not.toContain('assets/a.png');
  });

  it('a resolved title is put back exactly as the file wrote it', async () => {
    // The rewrite swaps an address and nothing else. Asserted on the display
    // body rather than only on the saved bytes, because the serializer would
    // hide a respelling here by writing its own spelling over it.
    const { io } = diskWith("![d](assets/a.png 'kept as it was')\n");
    const loaded = await loadMarkdown(DOCUMENT_PATH, io);
    const displayBody = await prepareMarkdownForDisplay(loaded.document, io);
    // Both halves, because either alone is vacuous: a reference that never
    // resolved also still carries its title, so the rewrite has to be shown to
    // have happened before its faithfulness means anything.
    expect(displayBody).toContain('blob:');
    expect(displayBody).toContain("'kept as it was'");
  });

  it('every image of a document resolves, not only its bytes surviving (#232)', async () => {
    // **The assertion this file was missing, and it cost a round.** Every test
    // here asked whether the bytes came back; none asked whether the pictures
    // drew. So a fixture could pass the whole file and still hand the owner a
    // broken image, which is exactly what happened on #230 and would have
    // happened again here: an alt holding an escaped bracket matched nothing in
    // the loader, so one of three images never resolved.
    //
    // A count, because it is the only shape that fails for the right reason: a
    // document whose references all resolve has as many registered images as it
    // has distinct pictures.
    const text =
      '# Alt test\n\n' +
      '![say "hi" to the chart](assets/a.png)\n\n' +
      '![step \\] two](assets/b.png)\n\n' +
      '![plain label](assets/c.png)\n';
    const { io } = diskWith(text);
    const loaded = await loadMarkdown(DOCUMENT_PATH, io);
    const displayBody = await prepareMarkdownForDisplay(loaded.document, io);

    expect(getAllImages()).toHaveLength(3);
    expect(displayBody).not.toContain('assets/');
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

/**
 * Bytes kept for a block are written back with the addresses the file wrote
 * (#468). Every kept source, a raw table (#283), a block of the tag filter
 * (#461) and a wrapper (#468), is read from the markdown after the display
 * pass has put a `blob:` address in place of each image it resolved, so its
 * bytes held that address, and an untouched save wrote it into the file in
 * place of the image path: measured on #468 for all three, on the route these
 * rows run, which every other guard skips. The image spelling had met the same
 * thing at #27 and maps the address back; the kept bytes now do too.
 */
describe('bytes kept for a block carry the image path, not the display address (#468)', () => {
  const IMG = '<img src="assets/a.png" alt="pic" width="200">';
  it.each([
    [
      'a raw table holding an image (#283)',
      `<table>\n<tr><td>${IMG}</td><td>b</td></tr>\n</table>\n`,
    ],
    [
      'a block of the tag filter holding an image (#461)',
      `<div>\n${IMG} <style>p {}</style>\n</div>\n`,
    ],
    [
      'a centred p around an image, three lines (#468)',
      `x\n\n<p align="center">\n  ${IMG}\n</p>\n\ny\n`,
    ],
    ['a centred p around an image, one line (#468)', `x\n\n<p align="center">${IMG}</p>\n\ny\n`],
    [
      'a centred div around an image, three lines (#468)',
      `x\n\n<div align="center">\n  ${IMG}\n</div>\n\ny\n`,
    ],
    [
      'a centred div around an image, one line (#468)',
      `x\n\n<div align="center">${IMG}</div>\n\ny\n`,
    ],
    [
      'a centred div around a markdown image, blank lines inside (#468)',
      'x\n\n<div align="center">\n\n![pic](assets/a.png)\n\n</div>\n\ny\n',
    ],
  ])('%s', async (_label, text) => {
    const written = await openAndSaveThroughDisplay(text);
    expect(written).not.toContain('blob:');
    expect(written).toBe(text);
  });
});
