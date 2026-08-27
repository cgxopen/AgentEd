/**
 * Issue #127 — a read of a path that could not be resolved used to
 * answer with the contents of the document already open.
 *
 * `readText` and `readBinary` both did `resolveFileHandle(path)`, and
 * where that answered `null` — which it does on **every** failure, not
 * only on not-found — fell back to `this.fileHandle`. So a read of
 * `notes/AGENTS.md` returned the open document's text, successfully,
 * with nothing reported anywhere.
 *
 * The fallback itself is legitimate and is kept: with no directory
 * handle the only file this platform can see is the one the user picked,
 * and reading it **by its own name** is how every web session opens its
 * first document. What was wrong is reaching that file under any other
 * name, and reaching it because a resolve failed for a reason that has
 * nothing to do with names.
 *
 * The rule is `grantedFileFor`, and it was already written twice in this
 * file before #127 — in `readSnapshot`, and in `resolveOrCreateFileHandle`
 * with the comment saying why. The write path was hardened against
 * exactly this hazard and the read path never was. All four sites
 * delegate to it now, so these pin the rule rather than four copies of
 * it.
 *
 * States are built from named `DOMException`s and asserted by name,
 * never by message text: the name is part of the File System Access API
 * and reads the same in every locale.
 */
import { describe, expect, it } from 'vitest';
import { WebIO } from './web';

const OPEN_DOC = '# the document the user already had open';

function dom(name: string): DOMException {
  return new DOMException(`stub: ${name}`, name);
}

function fileHandleFor(name: string, text: string): unknown {
  return {
    name,
    getFile: async () => ({
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    }),
  };
}

/**
 * A session that has only ever been handed one file — no directory
 * handle. This is what every web session looks like until a Save As.
 */
function singleGrantedFile(name = 'notes.md'): WebIO {
  const io = new WebIO();
  (io as unknown as { fileHandle: unknown }).fileHandle = fileHandleFor(name, OPEN_DOC);
  return io;
}

/**
 * A granted folder whose lookups all fail with `rejection`, plus the
 * open document's handle — the state that produced the swap.
 */
function grantedFolderFailingWith(rejection: string, openName = 'notes.md'): WebIO {
  const io = new WebIO();
  const fail = async (): Promise<never> => {
    throw dom(rejection);
  };
  (io as unknown as { dirHandle: unknown }).dirHandle = {
    getFileHandle: fail,
    getDirectoryHandle: fail,
    values: fail,
  };
  (io as unknown as { fileHandle: unknown }).fileHandle = fileHandleFor(openName, OPEN_DOC);
  return io;
}

describe('#127 — a read that did not happen never answers with another document', () => {
  for (const rejection of ['NotFoundError', 'NotAllowedError', 'TypeMismatchError']) {
    it(`readText rejects rather than falling back — ${rejection}`, async () => {
      const io = grantedFolderFailingWith(rejection);

      await expect(io.readText('notes/AGENTS.md')).rejects.toBeInstanceOf(Error);
      // The assertion that matters is not "it threw" — it is that the
      // open document's text is nowhere in the answer.
      await expect(io.readText('notes/AGENTS.md')).rejects.not.toBe(OPEN_DOC);
    });

    it(`readBinary rejects rather than falling back — ${rejection}`, async () => {
      const io = grantedFolderFailingWith(rejection);

      await expect(io.readBinary('assets/diagram.png')).rejects.toBeInstanceOf(Error);
    });
  }

  it('and not even when the requested name happens to match the open document', async () => {
    // Two files can share a name. `notes/notes.md` is not `notes.md`,
    // and a granted folder is the authority on what is inside it — so
    // nothing falls back past one.
    const io = grantedFolderFailingWith('NotAllowedError', 'notes.md');

    await expect(io.readText('notes/notes.md')).rejects.toBeInstanceOf(Error);
    await expect(io.readBinary('notes/notes.md')).rejects.toBeInstanceOf(Error);
  });
});

describe('#127 — the single granted file is still reachable by its own name', () => {
  // This is the path every web session takes to open its first document:
  // `openFile` sets the handle, and `loadMarkdown` then reads it back by
  // the bare name the handle carries. Remove the fallback and the web
  // build cannot open anything at all — which is why it is pinned here
  // rather than left to be read as dead code.
  it('readText answers with it', async () => {
    const io = singleGrantedFile('notes.md');

    await expect(io.readText('notes.md')).resolves.toBe(OPEN_DOC);
  });

  it('readBinary answers with it', async () => {
    const io = singleGrantedFile('notes.md');

    const bytes = await io.readBinary('notes.md');
    expect(new TextDecoder().decode(bytes)).toBe(OPEN_DOC);
  });

  it('readSnapshot answers with it, as it already did', async () => {
    const io = singleGrantedFile('notes.md');

    await expect(io.readSnapshot('notes.md')).resolves.toEqual({
      kind: 'file',
      text: OPEN_DOC,
    });
  });

  it('but under any other name, all three refuse', async () => {
    const io = singleGrantedFile('notes.md');

    await expect(io.readText('AGENTS.md')).rejects.toBeInstanceOf(Error);
    await expect(io.readBinary('AGENTS.md')).rejects.toBeInstanceOf(Error);
    const snapshot = await io.readSnapshot('AGENTS.md');
    expect(snapshot.kind).toBe('unreadable');
  });

  it('and a path that merely ends with that name is still another file', async () => {
    const io = singleGrantedFile('notes.md');

    // `notes/notes.md` shares only its last segment. With no directory
    // handle this platform cannot see inside any folder, so there is
    // nothing here to answer with.
    //
    // Both earlier copies of the rule compared basenames and would have
    // answered with the document. Nothing reached them that way — a
    // folder in the path is refused earlier, on the write side — but a
    // rule that is correct only because of a guard elsewhere is the kind
    // this issue is about.
    await expect(io.readText('notes/notes.md')).rejects.toBeInstanceOf(Error);
    const snapshot = await io.readSnapshot('notes/notes.md');
    expect(snapshot.kind).toBe('unreadable');
    await expect(io.saveFile('notes/notes.md', 'x')).rejects.toBeInstanceOf(Error);
  });
});

describe('#127 — the write path keeps the rule it always had', () => {
  it('saveFile writes the granted file under its own name', async () => {
    const written: string[] = [];
    const io = new WebIO();
    (io as unknown as { fileHandle: unknown }).fileHandle = {
      name: 'notes.md',
      createWritable: async () => ({
        write: async (text: string) => {
          written.push(String(text));
        },
        close: async () => {},
      }),
    };

    await io.saveFile('notes.md', 'new text');
    expect(written).toEqual(['new text']);
  });

  it('and refuses any other name, as it has since the comment was written', async () => {
    const io = singleGrantedFile('notes.md');

    await expect(io.saveFile('assets/diagram.png', 'x')).rejects.toBeInstanceOf(Error);
  });
});
