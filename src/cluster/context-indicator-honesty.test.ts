/**
 * Issue #126 — the context indicator named files that were never found.
 *
 * `WebIO.exists` answered a boolean, and #58 leaned it toward *there
 * might be something there* so an unreadable `assets/` folder could not
 * pass for an empty one. That was right for one caller out of five.
 * `probeOne` and both claims in `shouldShowSidebar` read the same
 * primitive as *this is there*, so with a folder grant gone the
 * indicator reported **six** context files, one per canonical name, none
 * of which anyone could open — and clicking one handed the editor the
 * open document under a name the application had invented.
 *
 * These drive the **real** detector and the **real** `shouldShowSidebar`
 * over the **real** `WebIO`, with only the directory handle constructed.
 * The states are the enumeration in #126 and each is identified by
 * `DOMException.name`, never by message text: the name is part of the
 * File System Access API and reads the same in every locale, while the
 * message is prose the browser may change or translate.
 *
 * Reaching `probeOne` at all needs a document path that carries a
 * directory. On this platform `openFile` and `pickSavePath` answer a
 * bare handle name, so detection exits before probing anything; the
 * route that produces a directory is the sidebar (R-C6), opening a
 * markdown file inside an adjacent folder. Both are pinned below,
 * because "it cannot happen here" is the claim this issue disproved.
 */
import { describe, expect, it } from 'vitest';
import { shouldShowSidebar } from '../app/sidebar-sync';
import type { PlatformIO } from '../platform/types';
import { WebIO } from '../platform/web';
import { detectContextCluster } from './detector';
import { getCanonicalFilenames } from './registry';

function dom(name: string): DOMException {
  return new DOMException(`stub: ${name}`, name);
}

function webIO(dirHandle: unknown): PlatformIO {
  const io = new WebIO();
  (io as unknown as { dirHandle: unknown }).dirHandle = dirHandle;
  return io;
}

/** Every lookup on the handle is refused: the folder grant is gone. */
function grantRevoked(): unknown {
  const fail = async (): Promise<never> => {
    throw dom('NotAllowedError');
  };
  return { getFileHandle: fail, getDirectoryHandle: fail, values: fail };
}

/**
 * `notes` is a file. A path that walks *through* it — `notes/CLAUDE.md`
 * — cannot be looked up, and the browser says so with
 * `TypeMismatchError`. Probing `notes` itself would be `present`, and
 * rightly: something is there.
 */
function componentIsAFile(): unknown {
  const fail = async (): Promise<never> => {
    throw dom('TypeMismatchError');
  };
  return { getFileHandle: async () => ({}), getDirectoryHandle: fail, values: fail };
}

/**
 * A granted folder holding `notes/`, whose contents are `present`.
 * `getFileHandle` on the root answers `TypeMismatchError` for `notes`
 * because it is a directory — the step `navigateTo` walks past.
 */
function grantedTree(inNotes: string[]): unknown {
  const notes = {
    values: () => ({
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next: async () =>
            i >= inNotes.length
              ? { done: true, value: undefined }
              : { done: false, value: { name: inNotes[i++], kind: 'file' } },
        };
      },
    }),
    getFileHandle: async (n: string) => {
      if (!inNotes.includes(n)) throw dom('NotFoundError');
      return {};
    },
    getDirectoryHandle: async (): Promise<never> => {
      throw dom('NotFoundError');
    },
  };
  return {
    getFileHandle: async (n: string) => {
      if (n === 'notes') throw dom('TypeMismatchError');
      throw dom('NotFoundError');
    },
    getDirectoryHandle: async (n: string) => {
      if (n !== 'notes') throw dom('NotFoundError');
      return notes;
    },
  };
}

describe('#126 — the indicator names only what was found', () => {
  it('a revoked grant reports nothing, not one entry per canonical name', async () => {
    const io = webIO(grantRevoked());

    const cluster = await detectContextCluster('notes/doc.md', io);

    // Measured at 4575563: six entries — AGENTS.md, CLAUDE.md,
    // .hermes.md, HERMES.md, .cursorrules, SOUL.md — every canonical
    // name, because an unanswered lookup counted as a hit.
    expect(cluster.entries).toEqual([]);
    expect(cluster.relatedCount).toBe(0);
    expect(getCanonicalFilenames().length).toBeGreaterThan(1);
  });

  it('a path component that is a file reports nothing either', async () => {
    const io = webIO(componentIsAFile());

    const cluster = await detectContextCluster('notes/doc.md', io);

    expect(cluster.entries).toEqual([]);
  });

  it('a context file genuinely there is still named — the control', async () => {
    const io = webIO(grantedTree(['doc.md', 'CLAUDE.md']));

    const cluster = await detectContextCluster('notes/doc.md', io);

    // R-A2 still delivers what it promises: `unknown` is not counted,
    // and `present` is.
    expect(cluster.entries.map((e) => e.relativePath)).toEqual(['CLAUDE.md']);
  });

  it('a readable folder holding no context file reports nothing', async () => {
    const io = webIO(grantedTree(['doc.md']));

    const cluster = await detectContextCluster('notes/doc.md', io);

    expect(cluster.entries).toEqual([]);
  });

  it('a bare web path never reaches the probes at all', async () => {
    // What Save As and Open hand back on this platform. Pinned so the
    // claim in the issue stays true rather than remembered.
    const io = webIO(grantRevoked());

    const cluster = await detectContextCluster('notes.md', io);

    expect(cluster.entries).toEqual([]);
  });
});

describe('#126 — the sidebar makes its two claims only from a lookup that happened', () => {
  it('a revoked grant shows no sidebar, and now says which kind of nothing', async () => {
    const io = webIO(grantRevoked());

    // Both claims in one call: the sibling folder, then `assets/`. At
    // 4575563 the first one answered `true` and rooted the panel at a
    // folder nobody had seen.
    //
    // Still no tree — and since #184 the answer says **why** there is
    // none. A revoked grant is `unknown` at `entryPresence`, so nothing
    // was looked at and the panel's absence would be a false statement
    // about the folder.
    await expect(shouldShowSidebar('notes.md', io)).resolves.toEqual({
      kind: 'no-folder-access',
    });
  });

  it('both claims are made for a nested document, and both stay silent', async () => {
    // A nested path is what runs the second claim as well: the sibling
    // folder `notes/doc`, then `notes/assets`. A bare name has no parent
    // and only ever asks the first.
    const io = webIO(grantRevoked());

    await expect(shouldShowSidebar('notes/doc.md', io)).resolves.toEqual({
      kind: 'no-folder-access',
    });
  });

  it('a lookup refused for some other reason stays silent too', async () => {
    // Classified by name, not by message, and not by an allow-list of
    // names either: anything that is not `NotFoundError` is a lookup
    // that did not happen.
    const io = webIO({
      getFileHandle: async (): Promise<never> => {
        throw dom('SecurityError');
      },
      getDirectoryHandle: async (): Promise<never> => {
        throw dom('SecurityError');
      },
    });

    await expect(shouldShowSidebar('notes/doc.md', io)).resolves.toEqual({
      kind: 'no-folder-access',
    });
  });

  it('an adjacent folder that is really there still shows — the control', async () => {
    const io = webIO(grantedTree(['doc.md']));

    await expect(shouldShowSidebar('notes.md', io)).resolves.toEqual({
      kind: 'tree',
      root: 'notes',
    });
  });
});
