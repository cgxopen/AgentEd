/**
 * Issue #187 — a document's images were resolved on one platform only,
 * because the loader asked which platform it was rather than whether it
 * could reach the folder beside the document.
 *
 * **Two locks, one defect.** `isTauri` was standing in for *can I read
 * that folder*; the two coincided while the web build could reach no
 * folder at all, and #188 stopped them coinciding. Behind it,
 * `if (!docDir) return md` looked like arithmetic and was a policy — an
 * empty parent is a malformed path on the desktop and the root of the
 * grant on the web, which is where both routes to a grant put the
 * document. Removing either alone leaves the ordinary case broken.
 *
 * **Both platforms are driven in one file**, over the real `WebIO` and
 * the real `TauriIO`, and that is itself a consequence of the repair:
 * the loader no longer imports `platform/detect`, so there is no
 * module-load constant to mock and no reason for one file per platform.
 * The two halves fail for opposite reasons — a repair too narrow leaves
 * the web unchanged, and one too wide makes a bare name resolve on the
 * desktop, where it is malformed.
 */
import { readFile } from '@tauri-apps/plugin-fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, getAllImages } from '../editor/image-registry';
import type { DocumentBundle } from '../formats/types';
import { WebIO } from '../platform/web';
import { prepareMarkdownForDisplay } from './image-loader';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(async (path: string) => {
    if (!ON_DISK.has(path)) throw new Error(`ENOENT: ${path}`);
    return PNG;
  }),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  readDir: vi.fn(),
  exists: vi.fn(),
}));

const PNG = new Uint8Array([137, 80, 78, 71]);
/** What the desktop filesystem holds, by absolute path. */
const ON_DISK = new Set(['/proj/assets/img.png']);

const MD = '# Doc\n\n![alt](assets/img.png)\n';

function bundle(rootPath: string): DocumentBundle {
  return { markdownBody: MD, rootPath } as DocumentBundle;
}

function dom(name: string): DOMException {
  return new DOMException(`stub: ${name}`, name);
}

function fileH(name: string): unknown {
  return { kind: 'file', name, getFile: async () => ({ arrayBuffer: async () => PNG.buffer }) };
}

function dirH(name: string, files: string[], dirs: Record<string, unknown> = {}): unknown {
  return {
    kind: 'directory',
    name,
    getFileHandle: async (n: string) => {
      if (!files.includes(n)) throw dom('NotFoundError');
      return fileH(n);
    },
    getDirectoryHandle: async (n: string) => {
      if (!(n in dirs)) throw dom('NotFoundError');
      return dirs[n];
    },
    // The document sits at the root of the grant, which is where both
    // routes to a grant put it.
    resolve: async (h: { name: string }) => (h.name === 'notes.md' ? [h.name] : null),
  };
}

/** A web session holding a folder that contains `assets/img.png`. */
function grantedWeb(): WebIO {
  const io = new WebIO();
  (io as unknown as { dirHandle: unknown }).dirHandle = dirH('proj', ['notes.md'], {
    assets: dirH('assets', ['img.png']),
    sub: dirH('sub', ['notes.md'], { assets: dirH('assets', ['img.png']) }),
  });
  return io;
}

/** A web session that was handed a file and no folder. */
function ungrantedWeb(): WebIO {
  const io = new WebIO();
  (io as unknown as { fileHandle: unknown }).fileHandle = fileH('notes.md');
  return io;
}

async function desktopIO() {
  const { TauriIO } = await import('../platform/tauri');
  return new TauriIO();
}

/** Whether the reference was replaced by something the editor can show. */
function resolved(out: string): boolean {
  return out !== MD && !out.includes('](assets/img.png)');
}

beforeEach(() => {
  clearImages();
  vi.mocked(readFile).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('#187 — the web build resolves a document images', () => {
  it('a document at the root of the granted folder', async () => {
    // The ordinary case, and the one the second lock hit: `dirname` is
    // empty here, and `joinPath` drops the empty segment, so
    // `assets/img.png` resolves against the grant.
    const out = await prepareMarkdownForDisplay(bundle('notes.md'), grantedWeb());

    expect(resolved(out)).toBe(true);
    expect(getAllImages()).toHaveLength(1);
    expect(getAllImages()[0].relativePath).toBe('assets/img.png');
  });

  it('and one in a subfolder of it, resolved beside itself', async () => {
    const out = await prepareMarkdownForDisplay(bundle('sub/notes.md'), grantedWeb());

    expect(resolved(out)).toBe(true);
  });

  it('with no folder granted, nothing is attempted and nothing is claimed', async () => {
    // Owner decision of 2026-08-30: the panel already carries the offer
    // in this state (#184), so the answer is one panel away and a second
    // notice per document is what R-C5 refuses.
    const out = await prepareMarkdownForDisplay(bundle('notes.md'), ungrantedWeb());

    expect(out).toBe(MD);
    expect(getAllImages()).toHaveLength(0);
  });
});

describe('#187 — the desktop floor, unchanged', () => {
  it('every image in a document still resolves', async () => {
    const out = await prepareMarkdownForDisplay(bundle('/proj/doc.md'), await desktopIO());

    expect(resolved(out)).toBe(true);
    expect(getAllImages()).toHaveLength(1);
  });

  it.each([
    ['a double-quoted title', '![alt](assets/img.png "the title")'],
    ['a single-quoted title', "![alt](assets/img.png 'the title')"],
    ['a parenthesised title', '![alt](assets/img.png (the title))'],
    ['a title holding an escaped quote', '![alt](assets/img.png "say \\" now")'],
    ['a title holding a closing parenthesis', '![alt](assets/img.png "a ) c")'],
    ['spaces around the title', '![alt](assets/img.png   "spaced"  )'],
  ])('the destination stops before %s, so the file read gets a path', async (_label, line) => {
    // **The defect this replaces drew a broken image and left the bytes
    // alone**, which is why the round-trip guard could not see it: the
    // destination group ran to the closing bracket, so the read was asked for
    // `assets/img.png "the title"` and failed. Found by the owner manual pass
    // on #230.
    //
    // Asserted on the *path the read was asked for*, not only on the outcome —
    // an unresolved reference and a resolved one differ in the document, but
    // what separates a repaired split from a lucky one is which string reached
    // the filesystem.
    const doc = { markdownBody: `# Doc\n\n${line}\n`, rootPath: '/proj/doc.md' } as DocumentBundle;
    const out = await prepareMarkdownForDisplay(doc, await desktopIO());

    expect(readFile).toHaveBeenCalledWith('/proj/assets/img.png');
    expect(getAllImages()).toHaveLength(1);
    expect(out).toContain('blob:');
    expect(out).not.toContain('assets/img.png');
  });

  it.each([
    ['an escaped closing bracket', '![step \\] two](assets/img.png)'],
    ['an escaped opening bracket', '![step \\[ two](assets/img.png)'],
    ['a pair of escaped brackets', '![a \\[b\\] c](assets/img.png)'],
    ['a backslash', '![a \\\\ b](assets/img.png)'],
    ['a double quote', '![say "hi"](assets/img.png)'],
    ['a bracket and a title together', '![a \\] b](assets/img.png "t")'],
  ])('an alt holding %s does not stop the image resolving', async (_label, line) => {
    // **The half a byte comparison cannot see.** The alt group stopped at the
    // first `]`, so a reference holding an escaped one matched nothing and the
    // image drew broken — the same failure the title half met on #230, in the
    // same expression, one group to its left. It went unmet for the same
    // reason: the serializer destroyed that alt on the first save, so the
    // reference the loader could not read stopped existing. #232 makes it
    // survive, so the breakage would have become permanent.
    const doc = { markdownBody: `# Doc\n\n${line}\n`, rootPath: '/proj/doc.md' } as DocumentBundle;
    const out = await prepareMarkdownForDisplay(doc, await desktopIO());

    expect(readFile).toHaveBeenCalledWith('/proj/assets/img.png');
    expect(getAllImages()).toHaveLength(1);
    expect(out).toContain('blob:');
  });

  it('and the alt itself is put back exactly as the file wrote it', async () => {
    const doc = {
      markdownBody: '# Doc\n\n![step \\] two](assets/img.png)\n',
      rootPath: '/proj/doc.md',
    } as DocumentBundle;
    const out = await prepareMarkdownForDisplay(doc, await desktopIO());

    expect(out).toContain('blob:');
    expect(out).toContain('![step \\] two](');
  });

  it('the title itself is put back exactly as the file wrote it', async () => {
    const doc = {
      markdownBody: "# Doc\n\n![alt](assets/img.png   'kept as it was'  )\n",
      rootPath: '/proj/doc.md',
    } as DocumentBundle;
    const out = await prepareMarkdownForDisplay(doc, await desktopIO());

    expect(out).toContain("   'kept as it was'  )");
  });

  it('a bare document name is refused before anything is read', async () => {
    // The half a repair too wide gets wrong. An empty parent means the
    // root of the grant on the web and a path with no folder on the
    // desktop, where joining against it would reach whatever directory
    // the process happens to be sitting in.
    //
    // **The refusal is asserted, not the outcome.** An unchanged
    // document is what *both* answers look like — refusing to try, and
    // trying and failing — so the first draft of this passed with the
    // capability check deleted, and the reversal is what found it. What
    // separates them is whether the filesystem was asked at all.
    const out = await prepareMarkdownForDisplay(bundle('doc.md'), await desktopIO());

    expect(readFile).not.toHaveBeenCalled();
    expect(out).toBe(MD);
    expect(getAllImages()).toHaveLength(0);
  });

  it('and a reference to a file that is not there is asked for, and left as written', async () => {
    // The contrast that makes the assertion above mean something: here
    // the read is attempted and fails, and the document is unchanged for
    // a different reason.
    const missing = '# Doc\n\n![alt](assets/gone.png)\n';
    const out = await prepareMarkdownForDisplay(
      { markdownBody: missing, rootPath: '/proj/doc.md' } as DocumentBundle,
      await desktopIO(),
    );

    expect(readFile).toHaveBeenCalledWith('/proj/assets/gone.png');
    expect(out).toBe(missing);
  });
});
