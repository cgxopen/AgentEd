/**
 * Issue #58 — on the web build a folder that cannot be read used to be
 * reported as a folder with nothing in it.
 *
 * `listDir` caught everything and returned `[]`, and `exists` caught
 * everything and returned `false`. Both are the same mistake in two
 * places: an answer the platform could not obtain, delivered as an
 * answer it did. The naming rule then had "no names are taken here"
 * about a folder nobody had looked into — which is how a save comes to
 * write over a file it never saw (R-C5).
 *
 * These pin the reads against handles that fail the way the File System
 * Access API fails: by `DOMException.name`, never by message text. The
 * name is part of the API and reads the same in every locale; the
 * message is prose the browser is free to change.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { WebIO } from './web';

/** A directory handle that fails every lookup with one named error. */
function handleRejecting(name: string): unknown {
  const fail = async (): Promise<never> => {
    throw new DOMException(`stub: ${name}`, name);
  };
  return { getDirectoryHandle: fail, getFileHandle: fail, values: fail };
}

/**
 * A directory holding `assets`, which exists as a directory and refuses
 * to be enumerated — the shape an operating system produces beneath the
 * handle when a folder may be written to but not listed.
 */
function handleWithUnenumerableAssets(): unknown {
  const assets = {
    values: () => ({
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<never> => {
            throw new DOMException('stub: cannot enumerate', 'NotAllowedError');
          },
        };
      },
    }),
  };
  return {
    // `assets` is a directory, so asking for it as a file is a type
    // mismatch — which is exactly what `navigateTo` walks past.
    getFileHandle: async (): Promise<never> => {
      throw new DOMException('stub: not a file', 'TypeMismatchError');
    },
    getDirectoryHandle: async (name: string) => {
      if (name !== 'assets') throw new DOMException('stub: no entry', 'NotFoundError');
      return assets;
    },
  };
}

/** A directory holding `assets` with one file in it. */
function handleWithAssets(names: string[]): unknown {
  const assets = {
    values: () => ({
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next: async () => {
            if (i >= names.length) return { done: true, value: undefined };
            const value = { name: names[i++], kind: 'file' };
            return { done: false, value };
          },
        };
      },
    }),
  };
  return {
    getFileHandle: async (): Promise<never> => {
      throw new DOMException('stub: not a file', 'TypeMismatchError');
    },
    getDirectoryHandle: async (name: string) => {
      if (name !== 'assets') throw new DOMException('stub: no entry', 'NotFoundError');
      return assets;
    },
  };
}

function webIO(dirHandle: unknown): WebIO {
  const io = new WebIO();
  (io as unknown as { dirHandle: unknown }).dirHandle = dirHandle;
  return io;
}

let io: WebIO;

describe('#58 — WebIO.listDir tells "nothing there" from "could not read"', () => {
  it('lists the folder when it can be read', async () => {
    io = webIO(handleWithAssets(['photo.png']));

    await expect(io.listDir('assets')).resolves.toEqual([
      { name: 'photo.png', path: 'assets/photo.png', isDirectory: false },
    ]);
  });

  it('a folder that is not there lists as nothing, which is true', async () => {
    io = webIO(handleRejecting('NotFoundError'));

    // The ordinary state of every never-saved document since #14 and
    // #45. It must stay quiet and successful.
    await expect(io.listDir('assets')).resolves.toEqual([]);
  });

  it('a folder it may not open is raised, not answered with an empty array', async () => {
    io = webIO(handleRejecting('NotAllowedError'));

    await expect(io.listDir('assets')).rejects.toBeInstanceOf(DOMException);
  });

  it('a folder that opens and refuses to be enumerated is raised too', async () => {
    // The failure arrives halfway through the iteration rather than at
    // the lookup, and it means the same thing: these names are unknown.
    io = webIO(handleWithUnenumerableAssets());

    await expect(io.listDir('assets')).rejects.toBeInstanceOf(DOMException);
  });

  it('no directory handle at all still lists as nothing', async () => {
    io = webIO(null);

    // Nothing has been granted, so there is no folder to be wrong about.
    // The insert never reaches here in this state — `canWriteCompanions`
    // answers one step earlier (#46).
    await expect(io.listDir('assets')).resolves.toEqual([]);
  });
});

describe('#58 — WebIO.exists says false only when nothing is there', () => {
  it('true for a folder it can open', async () => {
    io = webIO(handleWithAssets([]));

    await expect(io.exists('assets')).resolves.toBe(true);
  });

  it('false for a folder that is not there', async () => {
    io = webIO(handleRejecting('NotFoundError'));

    await expect(io.exists('assets')).resolves.toBe(false);
  });

  it('true for a folder it may not open — an unanswered question is not a "no"', async () => {
    io = webIO(handleRejecting('NotAllowedError'));

    // This is the pair that makes the distinction work: `listDir` says
    // it could not read, and this says the folder is nonetheless there.
    // Answering `false` here is what made an unreadable folder wear the
    // ordinary never-saved state.
    await expect(io.exists('assets')).resolves.toBe(true);
  });

  it('true for a folder that opens but cannot be enumerated', async () => {
    io = webIO(handleWithUnenumerableAssets());

    await expect(io.exists('assets')).resolves.toBe(true);
  });

  it('false with no directory handle at all', async () => {
    io = webIO(null);

    await expect(io.exists('assets')).resolves.toBe(false);
  });
});

describe('#58 — the two web states that reach the unreadable exit', () => {
  /**
   * Which platform states AgentEd can actually be in when it refuses.
   * Neither could be constructed against a real browser here — happy-dom
   * has no File System Access implementation — so what is pinned is the
   * classification, not the browser's ability to produce the state.
   *
   * They differ in one way that matters to nothing in the code and
   * everything in the message: in the first, the folder is shut because
   * the browser grant is gone; in the second, because the operating
   * system beneath the handle will not enumerate it. That is why the
   * sentence names permission without saying whose.
   */
  beforeEach(() => {
    io = webIO(null);
  });

  it('a grant that is gone: read fails, and so would the write', async () => {
    io = webIO(handleRejecting('NotAllowedError'));

    await expect(io.listDir('assets')).rejects.toBeInstanceOf(DOMException);
    await expect(io.exists('assets')).resolves.toBe(true);
    // Nothing could have been written in this state either, so the
    // refusal costs the user nothing they had.
    await expect(io.writeBinary('assets/photo.png', new Uint8Array([1]))).rejects.toBeInstanceOf(
      DOMException,
    );
  });

  it('a folder that opens, will not enumerate, and would accept the write', async () => {
    const writes: string[] = [];
    const assets = {
      values: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<never> => {
              throw new DOMException('stub: cannot enumerate', 'NotAllowedError');
            },
          };
        },
      }),
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async () => {
            writes.push(name);
          },
          close: async () => {},
        }),
      }),
    };
    io = webIO({
      getFileHandle: async (): Promise<never> => {
        throw new DOMException('stub: not a file', 'TypeMismatchError');
      },
      getDirectoryHandle: async () => assets,
    });

    await expect(io.listDir('assets')).rejects.toBeInstanceOf(DOMException);
    await expect(io.exists('assets')).resolves.toBe(true);
    // This is the state the refusal exists for: the write goes through,
    // so without it a name picked against an unread folder lands on
    // whatever was already there.
    await io.writeBinary('assets/photo.png', new Uint8Array([1]));
    expect(writes).toEqual(['photo.png']);
  });
});
