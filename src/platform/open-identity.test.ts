/**
 * Issue #141 — File → Open used to hand back a name, and a name is not
 * an identity on this platform.
 *
 * `openFile` opens the picker, reads the file it was handed, and used to
 * answer `handle.name`. Every later lookup by that bare name was
 * addressed to something that does not identify the picked file. With a
 * folder granted, `readText('notes.md')` resolved against the **grant
 * root**: it missed the picked file when it sat in a subfolder — the
 * reported failure — and, where the grant root happened to hold a file
 * of that name, answered with *that* one instead. Silently, and then the
 * save resolved the same way.
 *
 * The measured table at `78ba8dc`, over this same class with only the
 * handles constructed:
 *
 * | state | `readText('notes.md')` |
 * | --- | --- |
 * | grant, picked file in a subfolder | throws |
 * | no grant, same picked file | the picked file |
 * | grant, a same-named file at the grant root | **the root file** |
 * | grant, addressed as `doc/notes.md` | the picked file |
 *
 * Row 4 is the fix: when the granted folder can name the picked file,
 * `openFile` answers with **that** path and every existing lookup is
 * already right. Where it cannot — no grant, or a file outside the one
 * granted — the handle is registered under the name answered for it, so
 * that name reaches this file and no other, for reads and for the write
 * that follows.
 *
 * These drive the real `WebIO`, as #127, #129 and #130 did. Handles are
 * built from a tree that behaves like the File System Access API,
 * rejecting with named `DOMException`s and never with message text.
 */
import { describe, expect, it, vi } from 'vitest';
import { WebIO } from './web';

const PICKED = '# the file the user picked';
const NEIGHBOUR = '# a different file, wearing the same name';

// ── A file system built from handles ──

interface StubFile extends FileSystemFileHandle {
  /** What this file holds right now — the assertion the writes land in. */
  current(): string;
}

function fileHandle(name: string, initial: string): StubFile {
  let text = initial;
  return {
    kind: 'file',
    name,
    getFile: async () =>
      ({
        text: async () => text,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
      }) as unknown as File,
    createWritable: async () =>
      ({
        write: async (data: unknown) => {
          text = String(data);
        },
        close: async () => {},
      }) as unknown as FileSystemWritableFileStream,
    current: () => text,
  } as StubFile;
}

type Tree = { [name: string]: string | Tree };

interface StubDir extends FileSystemDirectoryHandle {
  files: Map<string, StubFile>;
  dirs: Map<string, StubDir>;
}

/**
 * A directory handle over `tree`. `getFileHandle` rejects with
 * `NotFoundError` for an entry that is not there and creates one on
 * `{ create: true }` — the two behaviours the save path depends on, and
 * the pair that let a save invent a file at the grant root.
 */
function dirHandle(name: string, tree: Tree): StubDir {
  const files = new Map<string, StubFile>();
  const dirs = new Map<string, StubDir>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') files.set(key, fileHandle(key, value));
    else dirs.set(key, dirHandle(key, value));
  }
  const dir = {
    kind: 'directory',
    name,
    files,
    dirs,
    getFileHandle: async (n: string, options?: { create?: boolean }) => {
      const existing = files.get(n);
      if (existing) return existing;
      if (!options?.create) throw new DOMException('stub: no entry', 'NotFoundError');
      const created = fileHandle(n, '');
      files.set(n, created);
      return created;
    },
    getDirectoryHandle: async (n: string, options?: { create?: boolean }) => {
      const existing = dirs.get(n);
      if (existing) return existing;
      if (!options?.create) throw new DOMException('stub: no entry', 'NotFoundError');
      const created = dirHandle(n, {});
      dirs.set(n, created);
      return created;
    },
    values: () => {
      const all = [...files.values(), ...dirs.values()];
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: async () =>
          i >= all.length
            ? { done: true as const, value: undefined }
            : { done: false as const, value: all[i++] },
      };
    },
    removeEntry: async () => {},
    /**
     * The real `resolve`: the components down to a descendant, and
     * `null` for a handle that is not one. This is what lets `openFile`
     * answer with a path the grant can use.
     */
    resolve: async (descendant: FileSystemHandle) => {
      function find(current: StubDir, prefix: string[]): string[] | null {
        for (const file of current.files.values()) {
          if (file === descendant) return [...prefix, file.name];
        }
        for (const sub of current.dirs.values()) {
          if (sub === descendant) return [...prefix, sub.name];
          const deeper = find(sub, [...prefix, sub.name]);
          if (deeper) return deeper;
        }
        return null;
      }
      return find(dir, []);
    },
  } as unknown as StubDir;
  return dir;
}

/** Put `handle` in front of the file picker `openFile` opens. */
function picker(handle: StubFile): void {
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(async () => [
    handle,
  ]);
}

function webIO(grant: StubDir | null): WebIO {
  const io = new WebIO();
  if (grant) (io as unknown as { dirHandle: unknown }).dirHandle = grant;
  return io;
}

/**
 * A granted folder holding `doc/notes.md`, plus a `notes.md` of its own
 * at the root. The collision the issue calls the silent half: two files,
 * one name, and only one of them was picked.
 */
function grantWithCollision(): { grant: StubDir; picked: StubFile; neighbour: StubFile } {
  const grant = dirHandle('project', { doc: { 'notes.md': PICKED }, 'notes.md': NEIGHBOUR });
  return {
    grant,
    picked: grant.dirs.get('doc')?.files.get('notes.md') as StubFile,
    neighbour: grant.files.get('notes.md') as StubFile,
  };
}

describe('#141 — the picked file inside the granted folder', () => {
  it('openFile answers with the path the grant names it by, not its bare name', async () => {
    const { grant, picked } = grantWithCollision();
    const io = webIO(grant);
    picker(picked);

    await expect(io.openFile()).resolves.toEqual({ content: PICKED, path: 'doc/notes.md' });
  });

  it('and every read of that path reaches the picked file', async () => {
    const { grant, picked } = grantWithCollision();
    const io = webIO(grant);
    picker(picked);

    const result = await io.openFile();
    const path = result?.path ?? '';

    await expect(io.readText(path)).resolves.toBe(PICKED);
    await expect(io.readSnapshot(path)).resolves.toEqual({ kind: 'file', text: PICKED });
  });

  it('a save lands in the picked file and leaves its same-named neighbour alone', async () => {
    const { grant, picked, neighbour } = grantWithCollision();
    const io = webIO(grant);
    picker(picked);

    const result = await io.openFile();
    await io.saveFile(result?.path ?? '', '# edited');

    expect(picked.current()).toBe('# edited');
    expect(neighbour.current()).toBe(NEIGHBOUR);
  });

  it('and the neighbour is still reachable under its own name', async () => {
    // Nothing is shadowed in this state: the answered path names the
    // picked file exactly, so the grant root keeps its own namespace.
    const { grant, picked, neighbour } = grantWithCollision();
    const io = webIO(grant);
    picker(picked);

    await io.openFile();

    await expect(io.readText('notes.md')).resolves.toBe(NEIGHBOUR);
    await io.saveFile('notes.md', '# written to the neighbour');
    expect(neighbour.current()).toBe('# written to the neighbour');
    expect(picked.current()).toBe(PICKED);
  });
});

describe('#141 — the picked file outside the granted folder', () => {
  /**
   * The grant cannot name this file — `resolve` says it is not a
   * descendant — so the answered path is the handle's own name, and the
   * handle is registered under it. The grant root's `notes.md` is
   * shadowed for as long as this document is open: the deliberate half
   * of the trade, against writing the user's document into a file they
   * never opened.
   */
  function outside(): { io: WebIO; picked: StubFile; neighbour: StubFile } {
    const grant = dirHandle('project', { 'notes.md': NEIGHBOUR });
    const elsewhere = dirHandle('desktop', { 'notes.md': PICKED });
    const picked = elsewhere.files.get('notes.md') as StubFile;
    picker(picked);
    return { io: webIO(grant), picked, neighbour: grant.files.get('notes.md') as StubFile };
  }

  it('openFile falls back to the name, having no path to give', async () => {
    const { io } = outside();

    await expect(io.openFile()).resolves.toEqual({ content: PICKED, path: 'notes.md' });
  });

  it('the read answers with the picked file, not the neighbour at the grant root', async () => {
    // The silent half of the defect, measured: before this, `readText`
    // resolved `notes.md` against the grant and returned NEIGHBOUR.
    const { io } = outside();

    await io.openFile();

    await expect(io.readText('notes.md')).resolves.toBe(PICKED);
    await expect(io.readSnapshot('notes.md')).resolves.toEqual({ kind: 'file', text: PICKED });
  });

  it('and so does the save — the neighbour is never written', async () => {
    // Acceptance criterion 3. Measured at `78ba8dc`, this save wrote the
    // user's document into the grant root's `notes.md`; where no such
    // file existed it created one, because `getFileHandle` was asked
    // with `{ create: true }`.
    const { io, picked, neighbour } = outside();

    await io.openFile();
    await io.saveFile('notes.md', '# edited');

    expect(picked.current()).toBe('# edited');
    expect(neighbour.current()).toBe(NEIGHBOUR);
  });

  it('R-C14 compares against the picked file, so an untouched one is no conflict', async () => {
    const { io } = outside();

    await io.openFile();

    // The baseline `applyLoadedDocument` records is the picked file's text. The
    // snapshot must be about the same file, or the user is asked about a
    // document they never opened.
    const snapshot = await io.readSnapshot('notes.md');
    expect(snapshot).toEqual({ kind: 'file', text: PICKED });
  });

  it('the registration is the answered path and nothing else', async () => {
    // `grantedFileFor`'s narrowness, kept: the whole path, never a
    // basename, and never a path this class did not itself hand out.
    // `doc/notes.md` must still be the granted folder's business.
    const grant = dirHandle('project', { doc: { 'notes.md': NEIGHBOUR } });
    const elsewhere = dirHandle('desktop', { 'notes.md': PICKED });
    picker(elsewhere.files.get('notes.md') as StubFile);
    const io = webIO(grant);

    await io.openFile();

    await expect(io.readText('doc/notes.md')).resolves.toBe(NEIGHBOUR);
    await expect(io.readText('other.md')).rejects.toBeInstanceOf(Error);
  });

  it('a browser without resolve() lands in the same place', async () => {
    // `resolve` is the one member of the API this class asks for that a
    // browser may not have shipped. Without it there is no path to give,
    // which is the state above — not a crash, and not a read that
    // reaches the neighbour.
    const grant = dirHandle('project', { doc: { 'notes.md': PICKED }, 'notes.md': NEIGHBOUR });
    const picked = grant.dirs.get('doc')?.files.get('notes.md') as StubFile;
    (grant as { resolve?: unknown }).resolve = undefined;
    picker(picked);
    const io = webIO(grant);

    await expect(io.openFile()).resolves.toEqual({ content: PICKED, path: 'notes.md' });
    await expect(io.readText('notes.md')).resolves.toBe(PICKED);
    await io.saveFile('notes.md', '# edited');
    expect(picked.current()).toBe('# edited');
    expect((grant.files.get('notes.md') as StubFile).current()).toBe(NEIGHBOUR);
  });
});

describe('#141 — the session with no folder granted', () => {
  it('opens its first document and reads it back by name, as it always has', async () => {
    // The fallback every web session takes before any Save As. Pinned
    // here as well as in the #127 tests: remove it and the web build
    // cannot open anything at all.
    const elsewhere = dirHandle('desktop', { 'notes.md': PICKED });
    const picked = elsewhere.files.get('notes.md') as StubFile;
    picker(picked);
    const io = webIO(null);

    await expect(io.openFile()).resolves.toEqual({ content: PICKED, path: 'notes.md' });
    await expect(io.readText('notes.md')).resolves.toBe(PICKED);
    await io.saveFile('notes.md', '# edited');
    expect(picked.current()).toBe('# edited');
  });

  it('and refuses every other name', async () => {
    const elsewhere = dirHandle('desktop', { 'notes.md': PICKED });
    picker(elsewhere.files.get('notes.md') as StubFile);
    const io = webIO(null);

    await io.openFile();

    await expect(io.readText('AGENTS.md')).rejects.toBeInstanceOf(Error);
    await expect(io.readText('notes/notes.md')).rejects.toBeInstanceOf(Error);
  });
});

describe('#141 — Save As re-anchors the document', () => {
  it('the destination it picks is not shadowed by the file opened before it', async () => {
    // Without clearing the registration, a Save As onto the grant root's
    // `notes.md` would go on writing the file opened from outside — the
    // same class of defect, one door further along.
    const grant = dirHandle('project', { 'notes.md': NEIGHBOUR });
    const elsewhere = dirHandle('desktop', { 'notes.md': PICKED });
    const picked = elsewhere.files.get('notes.md') as StubFile;
    const neighbour = grant.files.get('notes.md') as StubFile;
    picker(picked);
    const io = webIO(grant);

    await io.openFile();
    expect(await io.readText('notes.md')).toBe(PICKED);

    // Save As: a destination, then the folder grant it acquires.
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(
      async () => neighbour,
    );
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(
      async () => grant,
    );

    await expect(io.pickSavePath()).resolves.toBe('notes.md');

    await expect(io.readText('notes.md')).resolves.toBe(NEIGHBOUR);
    await io.saveFile('notes.md', '# saved as');
    expect(neighbour.current()).toBe('# saved as');
    expect(picked.current()).toBe(PICKED);
  });
});
