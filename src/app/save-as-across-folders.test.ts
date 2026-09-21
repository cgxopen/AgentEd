/**
 * #184 — a Save As can leave the document in one folder and the grant in
 * another, and the panel used to answer about the wrong one.
 *
 * Found by the owner during the manual pass for this change, and
 * reproduced here from his sequence: open `web.md` from a folder that
 * holds `web/`, Save As into a second folder that holds nothing, keep
 * the same file name. The panel went on showing the first folder's tree
 * — four files that are not beside the document, each of them clickable
 * and each of them opening from the other tree.
 *
 * **The name is what makes it visible rather than merely wrong.** A web
 * document's path is a bare name resolved against the grant, so
 * `web.md` asks the grant for `web/` — and the old grant has one. Saved
 * under any other name the same broken state answers `nothing-adjacent`
 * and hides, which is why an earlier probe of this sequence missed it.
 *
 * The hole is #147's, one feature over: `canWriteCompanions` was built
 * for exactly this split and the sidebar never asked it.
 *
 * These drive the **real** `WebIO` through the **real** `pickSavePath`,
 * because the defect lives in the seam between the grant and the
 * document identity — a fake `PlatformIO` in the middle would test the
 * seam it replaced.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebIO } from '../platform/web';
import { shouldShowSidebar } from './sidebar-sync';

function dom(name: string): DOMException {
  return new DOMException(`stub: ${name}`, name);
}

/**
 * `home` is which folder this handle really belongs to. The browser's
 * `resolve` compares handle **identity**, not names, and the whole of
 * this case is two different files called `web.md`, so a stub that
 * matched on the name would answer the question backwards.
 */
function fileHandle(name: string, home: string): unknown {
  return { kind: 'file', name, home, getFile: async () => ({ text: async () => 'test' }) };
}

/**
 * A directory handle. `contains` is what `resolve` will own — the File
 * System Access rule that a grant can only name its own descendants.
 */
function dirHandle(name: string, files: string[], dirs: Record<string, unknown> = {}): unknown {
  return {
    kind: 'directory',
    name,
    getFileHandle: async (n: string) => {
      if (!files.includes(n)) throw dom('NotFoundError');
      return fileHandle(n, name);
    },
    getDirectoryHandle: async (n: string) => {
      if (!(n in dirs)) throw dom('NotFoundError');
      return dirs[n];
    },
    // Identity, the way the API answers it: a folder can name its own
    // descendants and nothing else.
    resolve: async (h: { name: string; home?: string }) => (h.home === name ? [h.name] : null),
  };
}

/**
 * The folder the document starts in: `web.md` beside an `assets/` folder.
 *
 * It was a `web/` folder named after the document until #402, which left
 * `assets/` as the only trigger. The document sits at the root of the
 * grant, which is the shape #402 also repaired — its `assets/` folder had
 * never been probed there at all.
 */
function sourceFolder(): unknown {
  const assets = dirHandle('assets', ['cap1.md', 'cap2.md', 'note.txt', 'date.json']);
  return dirHandle('agented-146', ['web.md'], { assets });
}

/** The folder it moves to: flat, nothing adjacent to anything. */
function destinationFolder(): unknown {
  return dirHandle('agented-184', ['fara-grant.md', 'vecin.md', 'web.md']);
}

function sessionIn(folder: unknown): WebIO {
  const io = new WebIO();
  (io as unknown as { fileHandle: unknown }).fileHandle = fileHandle('web.md', 'agented-146');
  (io as unknown as { dirHandle: unknown }).dirHandle = folder;
  return io;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#184 — Save As into a second folder, under the same name', () => {
  it("the control: before the Save As, the tree is the source folder's", async () => {
    const io = sessionIn(sourceFolder());
    await expect(shouldShowSidebar('web.md', io)).resolves.toEqual({
      kind: 'tree',
      root: 'assets',
    });
  });

  it('the grant moves with the document → the panel says there is nothing beside it', async () => {
    const io = sessionIn(sourceFolder());
    vi.stubGlobal('showSaveFilePicker', async () => fileHandle('web.md', 'agented-184'));
    vi.stubGlobal('showDirectoryPicker', async () => destinationFolder());

    const path = await io.pickSavePath('Markdown', ['md']);

    expect(path).toBe('web.md');
    await expect(shouldShowSidebar(path ?? '', io)).resolves.toEqual({ kind: 'nothing-adjacent' });
  });

  it('the grant does NOT move → no tree from the folder the document left', async () => {
    // The reported state. `acquireDirectoryHandle` swallows a cancelled
    // picker, so the old grant stays and nothing says so.
    const io = sessionIn(sourceFolder());
    vi.stubGlobal('showSaveFilePicker', async () => fileHandle('web.md', 'agented-184'));
    vi.stubGlobal('showDirectoryPicker', async () => {
      throw dom('AbortError');
    });

    const path = await io.pickSavePath('Markdown', ['md']);
    const decision = await shouldShowSidebar(path ?? '', io);

    // Not a tree, and above all not the source folder's tree.
    expect(decision).toEqual({ kind: 'no-folder-access' });
    expect(decision).not.toEqual({ kind: 'tree', root: 'web' });
  });

  it('and the offer is the act that repairs it, not merely a report', async () => {
    // The state above resolves by granting the folder the document is
    // actually in — which is what the line the user is shown asks for.
    const io = sessionIn(sourceFolder());
    vi.stubGlobal('showSaveFilePicker', async () => fileHandle('web.md', 'agented-184'));
    vi.stubGlobal('showDirectoryPicker', async () => {
      throw dom('AbortError');
    });
    const path = await io.pickSavePath('Markdown', ['md']);
    await expect(shouldShowSidebar(path ?? '', io)).resolves.toEqual({ kind: 'no-folder-access' });

    vi.stubGlobal('showDirectoryPicker', async () => destinationFolder());
    await expect(io.requestFolderAccess()).resolves.toBe(true);

    await expect(shouldShowSidebar(path ?? '', io)).resolves.toEqual({ kind: 'nothing-adjacent' });
  });
});
