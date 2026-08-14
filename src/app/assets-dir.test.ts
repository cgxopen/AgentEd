import { describe, expect, it } from 'vitest';
import type { PlatformIO } from '../platform/types';
import { resolveAssetsDir } from './assets-dir';

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

describe('resolveAssetsDir', () => {
  it('picks <dirname>/assets/ next to the document', async () => {
    const info = await resolveAssetsDir(
      '/proj/notes.md',
      mockIO((p) => p === '/proj/assets'),
    );
    expect(info?.dir).toBe('/proj/assets');
    expect(info?.exists).toBe(true);
  });

  it('reports exists=false when assets/ is not on disk yet', async () => {
    const info = await resolveAssetsDir(
      '/proj/notes.md',
      mockIO(() => false),
    );
    expect(info?.dir).toBe('/proj/assets');
    expect(info?.exists).toBe(false);
  });

  it('ignores an adjacent folder named after the document', async () => {
    const info = await resolveAssetsDir(
      '/proj/notes.md',
      mockIO((p) => p === '/proj/notes' || p === '/proj/notes/assets'),
    );
    expect(info?.dir).toBe('/proj/assets');
  });

  it('treats a document inside its own folder like any other document', async () => {
    const info = await resolveAssetsDir(
      '/proj/my-doc/SKILL.md',
      mockIO(() => false),
    );
    expect(info?.dir).toBe('/proj/my-doc/assets');
  });

  it('rejects bare filename with no parent (returns null)', async () => {
    const info = await resolveAssetsDir(
      'notes.md',
      mockIO(() => false),
    );
    expect(info).toBeNull();
  });

  it('rejects a document at the filesystem root (parent === "/")', async () => {
    const info = await resolveAssetsDir(
      '/notes.md',
      mockIO(() => false),
    );
    expect(info).toBeNull();
  });
});
