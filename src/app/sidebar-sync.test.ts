import { describe, expect, it } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import { shouldShowSidebar } from './sidebar-sync';

interface MockIOOptions {
  /** Paths whose `exists` should return true. */
  existing?: ReadonlyArray<string>;
  /** Map from directory → entries returned by listDir. */
  entries?: Readonly<Record<string, FileEntry[]>>;
}

function mockIO(options: MockIOOptions = {}): PlatformIO {
  const existing = new Set(options.existing ?? []);
  return {
    supportsMultiFile: true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    exists: async (p: string) => existing.has(p),
    listDir: async (p: string) => options.entries?.[p] ?? [],
    mkdir: async () => {},
    remove: async () => {},
    openWithSystem: async () => {},
  };
}

describe('shouldShowSidebar', () => {
  it('hides when filePath is null', async () => {
    const decision = await shouldShowSidebar(null, mockIO());
    expect(decision.show).toBe(false);
  });

  it('adjacent folder named after the file → root = that folder', async () => {
    const decision = await shouldShowSidebar(
      '/proj/notes.md',
      mockIO({ existing: ['/proj/notes'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/notes' });
  });

  it('adjacent assets/ → root = <dirname>/assets/', async () => {
    const decision = await shouldShowSidebar(
      '/proj/notes.md',
      mockIO({ existing: ['/proj/assets'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/assets' });
  });

  it('the named folder wins over assets/ when both exist', async () => {
    const decision = await shouldShowSidebar(
      '/proj/notes.md',
      mockIO({ existing: ['/proj/notes', '/proj/assets'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/notes' });
  });

  it('no adjacent structure → hidden', async () => {
    const decision = await shouldShowSidebar('/proj/notes.md', mockIO());
    expect(decision.show).toBe(false);
  });

  it('a file at the filesystem root with no adjacent structure → hidden', async () => {
    const decision = await shouldShowSidebar('/notes.md', mockIO({ existing: ['/'] }));
    expect(decision.show).toBe(false);
  });
});
