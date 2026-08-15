/**
 * The unsaved-changes gate (R-C3). These cases cover the window-close path
 * specifically: it is the one that used to bypass the gate entirely, so
 * "cancel keeps the window open" and "discard leaves the disk untouched"
 * are pinned here rather than left to manual testing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from './context';
import { createDiscardGate } from './discard-gate';
import { AppState } from './state';

const showConfirmDialog = vi.hoisted(() => vi.fn());
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog }));

function makeCtx(state: AppState): { ctx: AppContext; dialogs: string[] } {
  const dialogs: string[] = [];
  const ctx = {
    state,
    reporter: {
      dialog: vi.fn(async (message: string) => {
        dialogs.push(message);
      }),
    },
  } as unknown as AppContext;
  return { ctx, dialogs };
}

describe('discard gate — window close', () => {
  beforeEach(() => {
    showConfirmDialog.mockReset();
  });

  it('closes straight away when nothing is modified', async () => {
    const state = new AppState();
    const { ctx } = makeCtx(state);
    const handleSave = vi.fn(async () => {});

    const gate = createDiscardGate(ctx, handleSave);

    await expect(gate('window-close')).resolves.toBe(true);
    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(handleSave).not.toHaveBeenCalled();
  });

  it('asks before closing a window with unsaved changes', async () => {
    const state = new AppState();
    state.filePath = '/docs/notes.md';
    state.setModified(true);
    const { ctx } = makeCtx(state);
    showConfirmDialog.mockResolvedValue('discard');

    await createDiscardGate(
      ctx,
      vi.fn(async () => {}),
    )('window-close');

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    const options = showConfirmDialog.mock.calls[0][0];
    expect(options.title).toBe('Unsaved changes');
    expect(options.message).toContain('notes.md');
    expect(options.message).toContain('closing the window');
    expect(options.actions.map((a: { value: string }) => a.value)).toEqual([
      'save',
      'discard',
      'cancel',
    ]);
  });

  it('cancel keeps the window open', async () => {
    const state = new AppState();
    state.setModified(true);
    const { ctx } = makeCtx(state);
    const handleSave = vi.fn(async () => {});
    showConfirmDialog.mockResolvedValue('cancel');

    await expect(createDiscardGate(ctx, handleSave)('window-close')).resolves.toBe(false);
    expect(handleSave).not.toHaveBeenCalled();
  });

  it('dismissing the dialog counts as cancel, never as discard', async () => {
    const state = new AppState();
    state.setModified(true);
    const { ctx } = makeCtx(state);
    showConfirmDialog.mockResolvedValue(null);

    await expect(
      createDiscardGate(
        ctx,
        vi.fn(async () => {}),
      )('window-close'),
    ).resolves.toBe(false);
  });

  it('discard closes without writing anything', async () => {
    const state = new AppState();
    state.setModified(true);
    const { ctx } = makeCtx(state);
    const handleSave = vi.fn(async () => {});
    showConfirmDialog.mockResolvedValue('discard');

    await expect(createDiscardGate(ctx, handleSave)('window-close')).resolves.toBe(true);
    expect(handleSave).not.toHaveBeenCalled();
  });

  it('save closes only after the save actually cleared the modified flag', async () => {
    const state = new AppState();
    state.setModified(true);
    const { ctx } = makeCtx(state);
    const handleSave = vi.fn(async () => {
      state.setModified(false);
    });
    showConfirmDialog.mockResolvedValue('save');

    await expect(createDiscardGate(ctx, handleSave)('window-close')).resolves.toBe(true);
    expect(handleSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the window open when the save was cancelled (still modified)', async () => {
    const state = new AppState();
    state.setModified(true);
    const { ctx } = makeCtx(state);
    // e.g. the user cancelled the Save As picker — nothing was written.
    const handleSave = vi.fn(async () => {});
    showConfirmDialog.mockResolvedValue('save');

    await expect(createDiscardGate(ctx, handleSave)('window-close')).resolves.toBe(false);
  });

  it('keeps the window open and reports when the save throws', async () => {
    const state = new AppState();
    state.filePath = '/docs/notes.md';
    state.setModified(true);
    const { ctx, dialogs } = makeCtx(state);
    const handleSave = vi.fn(async () => {
      throw new Error('disk full');
    });
    showConfirmDialog.mockResolvedValue('save');

    await expect(createDiscardGate(ctx, handleSave)('window-close')).resolves.toBe(false);
    expect(dialogs[0]).toContain('notes.md');
  });
});
