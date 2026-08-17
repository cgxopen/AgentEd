import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { confirmAssetsDir, resolveAssetsDir } from './assets-dir';
import { AppState } from './state';

vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));

/** Every mkdir the code under test asked for, in order. */
let mkdirCalls: string[] = [];

function mockIO(existsPredicate: (path: string) => boolean): PlatformIO {
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
    exists: async (p: string) => existsPredicate(p),
    listDir: async () => [],
    mkdir: async (p: string) => {
      mkdirCalls.push(p);
    },
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

/**
 * The consent stays at insert time; the folder does not (#14). These pin
 * both halves of that split — the prompt still runs and still cancels the
 * insert, and nothing reaches the filesystem here.
 */
describe('confirmAssetsDir — asks now, creates never (#14)', () => {
  beforeEach(() => {
    mkdirCalls = [];
    vi.mocked(showConfirmDialog).mockReset();
  });

  it('asks before an assets/ folder that does not exist, and creates nothing', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const state = new AppState();

    const dir = await confirmAssetsDir(
      '/proj/notes.md',
      mockIO(() => false),
      state,
    );

    expect(dir).toBe('/proj/assets');
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(mkdirCalls).toEqual([]);
  });

  it('cancelling refuses the folder, so the caller drops the insert', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    const state = new AppState();

    expect(
      await confirmAssetsDir(
        '/proj/notes.md',
        mockIO(() => false),
        state,
      ),
    ).toBeNull();
    expect(mkdirCalls).toEqual([]);
    expect(state.assetsDirCreationDeclined).toBe(true);
  });

  it('does not ask twice after a refusal in the same document session', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    const state = new AppState();
    const io = mockIO(() => false);

    await confirmAssetsDir('/proj/notes.md', io, state);
    await confirmAssetsDir('/proj/notes.md', io, state);

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing assets/ silently — no prompt, no warning (R-C5)', async () => {
    const state = new AppState();

    const dir = await confirmAssetsDir(
      '/proj/notes.md',
      mockIO((p) => p === '/proj/assets'),
      state,
    );

    expect(dir).toBe('/proj/assets');
    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(mkdirCalls).toEqual([]);
  });

  it('refuses an unusable path without asking anything', async () => {
    const state = new AppState();

    expect(
      await confirmAssetsDir(
        'notes.md',
        mockIO(() => false),
        state,
      ),
    ).toBeNull();
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });
});
