import { describe, expect, it } from 'vitest';
import type { PlatformIO } from '../platform/types';
import { detectDocumentShape } from './detect';

/** Mock IO whose `exists(path)` is driven by a predicate. No real FS. */
function mockIO(existsPredicate: (path: string) => boolean): PlatformIO {
  return {
    supportsMultiFile: true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    saveFileAs: async () => null,
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    exists: async (p: string) => existsPredicate(p),
    listDir: async () => [],
    mkdir: async () => {},
    remove: async () => {},
    openWithSystem: async () => {},
  };
}

describe('detectDocumentShape', () => {
  it('returns sibling structured when doc/assets/ exists alongside doc.md', async () => {
    const io = mockIO((p) => p === 'doc/assets');
    const shape = await detectDocumentShape('doc.md', io);
    expect(shape.layout).toBe('sibling');
    expect(shape.docFolder).toBe('doc');
  });

  it('returns sibling structured when doc/.agented-meta.json exists', async () => {
    const io = mockIO((p) => p === 'doc/.agented-meta.json');
    const shape = await detectDocumentShape('doc.md', io);
    expect(shape.layout).toBe('sibling');
  });

  it('returns sibling structured when legacy doc/attachments/ exists', async () => {
    const io = mockIO((p) => p === 'doc/attachments');
    const shape = await detectDocumentShape('doc.md', io);
    expect(shape.layout).toBe('sibling');
  });

  it('returns parent-as-folder for SKILL.md when parent is reachable', async () => {
    // Parent exists (Tauri scenario). No companion folders required.
    const io = mockIO((p) => p === 'my-skill');
    const shape = await detectDocumentShape('my-skill/SKILL.md', io);
    expect(shape.layout).toBe('parent-as-folder');
    expect(shape.docFolder).toBe('my-skill');
  });

  it('is case-insensitive: skill.md triggers parent-as-folder when parent reachable', async () => {
    const io = mockIO((p) => p === 'parent');
    const shape = await detectDocumentShape('parent/skill.md', io);
    expect(shape.layout).toBe('parent-as-folder');
  });

  it('is case-insensitive: Skill.md triggers parent-as-folder when parent reachable', async () => {
    const io = mockIO((p) => p === 'parent');
    const shape = await detectDocumentShape('parent/Skill.md', io);
    expect(shape.layout).toBe('parent-as-folder');
  });

  it('parent-as-folder wins over sibling when filename is SKILL.md', async () => {
    // Parent exists AND a coincidental parent/SKILL/assets/ exists —
    // filename is the stronger signal so parent wins.
    const io = mockIO((p) => p === 'parent' || p === 'parent/SKILL/assets');
    const shape = await detectDocumentShape('parent/SKILL.md', io);
    expect(shape.layout).toBe('parent-as-folder');
    expect(shape.docFolder).toBe('parent');
  });

  it('falls back to plain markdown for SKILL.md when parent is unreachable (web without dirHandle)', async () => {
    // Parent does not exist from IO perspective — the web-mode case.
    // Structured would be non-functional; plain markdown is honest.
    const io = mockIO(() => false);
    const shape = await detectDocumentShape('some/SKILL.md', io);
    expect(shape.layout).toBeNull();
    expect(shape.docFolder).toBeNull();
  });

  it('falls back to plain markdown for bare SKILL.md in web mode (no dirHandle, no sibling)', async () => {
    // File picker in web returns just the filename; dirname is '' so the
    // parent-as-folder branch is skipped, and without a dirHandle the
    // sibling probes also fail. Must not claim structured.
    const io = mockIO(() => false);
    const shape = await detectDocumentShape('SKILL.md', io);
    expect(shape.layout).toBeNull();
    expect(shape.docFolder).toBeNull();
  });

  it('returns plain markdown for a .md file with no siblings or markers', async () => {
    const io = mockIO(() => false);
    const shape = await detectDocumentShape('notes.md', io);
    expect(shape.layout).toBeNull();
    expect(shape.docFolder).toBeNull();
  });

  it('rejects filesystem root as docFolder: /SKILL.md does not claim parent-as-folder on /', async () => {
    // `dirname('/SKILL.md')` is '/'. Without the explicit root guard, even
    // though `io.exists('/')` is true, docFolder would become '/' and
    // saveStructured would then try to mkdir('/assets') — permission
    // denied on Linux, nonsense on macOS/Windows. Assert we don't take
    // the parent-as-folder branch in that case.
    const io = mockIO((p) => p === '/'); // only the root "exists"
    const shape = await detectDocumentShape('/SKILL.md', io);
    expect(shape.layout).not.toBe('parent-as-folder');
    expect(shape.docFolder).not.toBe('/');
  });

  it('returns plain markdown for a non-SKILL.md file even when parent has companion-looking folders', async () => {
    // `parent/mydoc.md` — mydoc.md isn't SKILL.md so even a reachable
    // parent doesn't trigger structured.
    const io = mockIO((p) => p === 'parent' || p === 'parent/scripts');
    const shape = await detectDocumentShape('parent/mydoc.md', io);
    expect(shape.layout).toBeNull();
    expect(shape.docFolder).toBeNull();
  });
});
