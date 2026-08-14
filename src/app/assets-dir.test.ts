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
  it('parent-as-folder: SKILL.md picks <parent>/assets/ regardless of existence', async () => {
    const info = await resolveAssetsDir(
      '/proj/my-skill/SKILL.md',
      mockIO(() => false),
    );
    expect(info?.dir).toBe('/proj/my-skill/assets');
    expect(info?.exists).toBe(false);
  });

  it('parent-as-folder: SKILL.md reports exists=true when assets/ is on disk', async () => {
    const info = await resolveAssetsDir(
      '/proj/my-skill/SKILL.md',
      mockIO((p) => p === '/proj/my-skill/assets'),
    );
    expect(info?.dir).toBe('/proj/my-skill/assets');
    expect(info?.exists).toBe(true);
  });

  it('sibling layout: notes.md with notes/ adjacent picks notes/assets/', async () => {
    const info = await resolveAssetsDir(
      '/proj/notes.md',
      mockIO((p) => p === '/proj/notes' || p === '/proj/notes/assets'),
    );
    expect(info?.dir).toBe('/proj/notes/assets');
    expect(info?.exists).toBe(true);
  });

  it('sibling layout: notes.md with notes/ but no assets/ inside reports exists=false', async () => {
    const info = await resolveAssetsDir(
      '/proj/notes.md',
      mockIO((p) => p === '/proj/notes'),
    );
    expect(info?.dir).toBe('/proj/notes/assets');
    expect(info?.exists).toBe(false);
  });

  it('plain layout: notes.md with no companion folder picks <dirname>/assets/', async () => {
    const info = await resolveAssetsDir(
      '/proj/notes.md',
      mockIO((p) => p === '/proj/assets'),
    );
    expect(info?.dir).toBe('/proj/assets');
    expect(info?.exists).toBe(true);
  });

  it('plain layout: notes.md without adjacent assets/ reports exists=false', async () => {
    const info = await resolveAssetsDir(
      '/proj/notes.md',
      mockIO(() => false),
    );
    expect(info?.dir).toBe('/proj/assets');
    expect(info?.exists).toBe(false);
  });

  it('rejects bare filename with no parent (returns null)', async () => {
    const info = await resolveAssetsDir(
      'notes.md',
      mockIO(() => false),
    );
    expect(info).toBeNull();
  });

  it('rejects /SKILL.md at filesystem root (parent === "/")', async () => {
    // SKILL.md branch refuses parent === '/'. Falls through to sibling
    // and plain branches; without a matching parent, returns null.
    const info = await resolveAssetsDir(
      '/SKILL.md',
      mockIO(() => false),
    );
    expect(info).toBeNull();
  });
});
