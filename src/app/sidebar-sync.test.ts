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
    saveFileAs: async () => null,
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
    const decision = await shouldShowSidebar('plain', null, mockIO());
    expect(decision.show).toBe(false);
  });

  it('hides for the llms-txt profile regardless of filesystem state', async () => {
    const decision = await shouldShowSidebar(
      'llms-txt',
      '/site/llms.txt',
      mockIO({ existing: ['/site'] }),
    );
    expect(decision.show).toBe(false);
  });

  it('parent-as-folder: SKILL.md with reachable parent → root = parent, hideRootMd', async () => {
    const decision = await shouldShowSidebar(
      'claude-skill',
      '/proj/my-skill/SKILL.md',
      mockIO({ existing: ['/proj/my-skill'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/my-skill', hideRootMd: true });
  });

  it('parent-as-folder: SKILL.md with unreachable parent falls through to plain layout', async () => {
    // Web mode without dir handle — exists() returns false everywhere
    const decision = await shouldShowSidebar('claude-skill', '/SKILL.md', mockIO());
    expect(decision.show).toBe(false);
  });

  it('sibling layout: notes.md with notes/ adjacent → root = notes/', async () => {
    const decision = await shouldShowSidebar(
      'plain',
      '/proj/notes.md',
      mockIO({ existing: ['/proj/notes'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/notes', hideRootMd: false });
  });

  it('plain with adjacent assets/ → root = <dirname>/assets/', async () => {
    const decision = await shouldShowSidebar(
      'plain',
      '/proj/notes.md',
      mockIO({ existing: ['/proj/assets'] }),
    );
    expect(decision).toEqual({ show: true, root: '/proj/assets', hideRootMd: false });
  });

  it('plain without any companion structure → hidden', async () => {
    const decision = await shouldShowSidebar('plain', '/proj/notes.md', mockIO());
    expect(decision.show).toBe(false);
  });

  it('rejects /SKILL.md at filesystem root (parent === "/")', async () => {
    const decision = await shouldShowSidebar(
      'claude-skill',
      '/SKILL.md',
      mockIO({ existing: ['/'] }),
    );
    expect(decision.show).toBe(false);
  });
});
