import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { confirmAssetsDir, resolveAssetsDir } from './assets-dir';
import { AppState } from './state';

vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));

/** Every mkdir the code under test asked for, in order. */
let mkdirCalls: string[] = [];

function mockIO(existsPredicate: (path: string) => boolean): PlatformIO {
  return {
    // Desktop-shaped, and it has to be: the two rejections these tests
    // pin — a bare name and the filesystem root — moved out of
    // `resolveAssetsDir` and into `TauriIO.canWriteCompanions` on #46,
    // because they are facts about desktop paths rather than about every
    // platform. Answering a flat `true` here would pass those tests over
    // a guard that no longer exists anywhere.
    canWriteCompanions: async (documentPath: string) => {
      const parent = dirname(documentPath);
      return parent.length > 0 && parent !== '/';
    },
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    readSnapshot: async () => ({ kind: 'absent' as const }),
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async (p: string) => (existsPredicate(p) ? 'present' : 'absent'),
    listDir: async () => [],
    mkdir: async (p: string) => {
      mkdirCalls.push(p);
    },
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
    // Nothing is remembered about a refusal (#66).
    expect(state.assetsDirConfirmedFor).toBeNull();
  });

  it('asks again after a refusal — cancel means "not this image" (#66)', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    const state = new AppState();
    const io = mockIO(() => false);

    await confirmAssetsDir('/proj/notes.md', io, state);
    await confirmAssetsDir('/proj/notes.md', io, state);

    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
  });

  it('accepts on a later attempt after a refusal, with no residue in between', async () => {
    const state = new AppState();
    const io = mockIO(() => false);

    vi.mocked(showConfirmDialog).mockResolvedValueOnce('cancel');
    expect(await confirmAssetsDir('/proj/notes.md', io, state)).toBeNull();

    vi.mocked(showConfirmDialog).mockResolvedValueOnce('create');
    expect(await confirmAssetsDir('/proj/notes.md', io, state)).toBe('/proj/assets');

    // And the agreement is sticky from there, as it always was (R-C5).
    expect(await confirmAssetsDir('/proj/notes.md', io, state)).toBe('/proj/assets');
    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
    expect(mkdirCalls).toEqual([]);
  });

  it('does not ask twice after acceptance — one dialog, however many images', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const state = new AppState();
    const io = mockIO(() => false);

    // Three screenshots pasted into a document that has not been saved
    // yet. The folder still does not exist on the third insert, so the
    // consent has to be remembered rather than inferred from the disk.
    const dirs = [
      await confirmAssetsDir('/proj/notes.md', io, state),
      await confirmAssetsDir('/proj/notes.md', io, state),
      await confirmAssetsDir('/proj/notes.md', io, state),
    ];

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(dirs).toEqual(['/proj/assets', '/proj/assets', '/proj/assets']);
    expect(mkdirCalls).toEqual([]);
  });

  it('asks again when Save As moves the document to a folder never agreed to', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const state = new AppState();
    const io = mockIO(() => false);

    await confirmAssetsDir('/proj/notes.md', io, state);
    expect(await confirmAssetsDir('/elsewhere/notes.md', io, state)).toBe('/elsewhere/assets');

    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
  });

  it('a refusal does not carry over to a different folder either', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValueOnce('cancel').mockResolvedValueOnce('create');
    const state = new AppState();
    const io = mockIO(() => false);

    expect(await confirmAssetsDir('/proj/notes.md', io, state)).toBeNull();
    expect(await confirmAssetsDir('/elsewhere/notes.md', io, state)).toBe('/elsewhere/assets');
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
