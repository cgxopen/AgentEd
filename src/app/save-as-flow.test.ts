/**
 * Save As picks a destination — it does not write (R-C3). Before this was
 * fixed, choosing a path handed an empty string to the platform's save
 * primitive, which truncated the chosen file on the spot: pick an existing
 * document in the dialog, close without saving, and the file was gone.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, FileResult, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createRequestSaveAs } from './save-as-flow';
import { AppState } from './state';

const io = vi.hoisted(() => ({
  supportsMultiFile: true,
  // Desktop-shaped: every path carries a directory (#46).
  canWriteCompanions: async () => true,
  openFile: vi.fn(async (): Promise<FileResult | null> => null),
  pickFile: vi.fn(async () => null),
  readText: vi.fn(async () => ''),
  saveFile: vi.fn(async () => {}),
  pickSavePath: vi.fn(async (): Promise<string | null> => null),
  installCloseGuard: vi.fn(async () => {}),
  readBinary: vi.fn(async () => new Uint8Array()),
  writeBinary: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  listDir: vi.fn(async (): Promise<FileEntry[]> => []),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  openWithSystem: vi.fn(async () => {}),
}));

vi.mock('../platform/index', () => ({
  getPlatformIO: async (): Promise<PlatformIO> => io as unknown as PlatformIO,
}));

function makeCtx(state: AppState): AppContext {
  return {
    state,
    setFilename: vi.fn(),
  } as unknown as AppContext;
}

describe('requestSaveAs', () => {
  it('writes nothing to disk when the user picks a destination', async () => {
    io.pickSavePath.mockResolvedValueOnce('/docs/existing.md');
    const state = new AppState();
    state.setModified(true);

    const path = await createRequestSaveAs(makeCtx(state))();

    expect(path).toBe('/docs/existing.md');
    expect(io.saveFile).not.toHaveBeenCalled();
    expect(io.writeBinary).not.toHaveBeenCalled();
  });

  it('leaves the document modified — picking a path is not a save', async () => {
    io.pickSavePath.mockResolvedValueOnce('/docs/notes.md');
    const state = new AppState();
    state.setModified(true);

    await createRequestSaveAs(makeCtx(state))();

    // Still dirty: the close gate must keep protecting this document until
    // the bytes actually reach the disk.
    expect(state.modified).toBe(true);
  });

  it('adopts the chosen path and shows it in the header', async () => {
    io.pickSavePath.mockResolvedValueOnce('/docs/notes.md');
    const state = new AppState();
    const ctx = makeCtx(state);

    await createRequestSaveAs(ctx)();

    expect(state.filePath).toBe('/docs/notes.md');
    expect(ctx.setFilename).toHaveBeenCalledWith('notes.md', '/docs/notes.md');
  });

  it('changes nothing when the picker is cancelled', async () => {
    io.pickSavePath.mockResolvedValueOnce(null);
    const state = new AppState();
    state.filePath = '/docs/original.md';

    const path = await createRequestSaveAs(makeCtx(state))();

    expect(path).toBeNull();
    expect(state.filePath).toBe('/docs/original.md');
    expect(io.saveFile).not.toHaveBeenCalled();
  });
});
