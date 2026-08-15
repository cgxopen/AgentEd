import { describe, expect, it, vi } from 'vitest';
import { createCloseGuard } from './close-guard';
import type { DocumentActions } from './document-actions';
import { AppState } from './state';

function makeDocActions(confirmWindowClose: () => Promise<boolean>): DocumentActions {
  return {
    handleNew: vi.fn(async () => {}),
    handleNewFromTemplate: vi.fn(async () => {}),
    handleOpen: vi.fn(async () => {}),
    handleSave: vi.fn(async () => {}),
    handleSaveAs: vi.fn(async () => {}),
    handleClose: vi.fn(async () => {}),
    openFilePath: vi.fn(async () => {}),
    requestSaveAs: vi.fn(async () => null),
    confirmWindowClose: vi.fn(confirmWindowClose),
  };
}

function deferred(): { promise: Promise<boolean>; resolve: (v: boolean) => void } {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createCloseGuard', () => {
  it('reports unsaved changes straight from state', () => {
    const state = new AppState();
    const guard = createCloseGuard(
      state,
      makeDocActions(async () => true),
    );

    expect(guard.hasUnsavedChanges()).toBe(false);
    state.setModified(true);
    expect(guard.hasUnsavedChanges()).toBe(true);
  });

  it('lets the close through when the gate allows it', async () => {
    const docActions = makeDocActions(async () => true);
    const guard = createCloseGuard(new AppState(), docActions);

    await expect(guard.confirmClose()).resolves.toBe(true);
    expect(docActions.confirmWindowClose).toHaveBeenCalledTimes(1);
  });

  it('blocks the close when the user cancels', async () => {
    const guard = createCloseGuard(
      new AppState(),
      makeDocActions(async () => false),
    );
    await expect(guard.confirmClose()).resolves.toBe(false);
  });

  it('refuses a second close request while the dialog is still open', async () => {
    const gate = deferred();
    const docActions = makeDocActions(() => gate.promise);
    const guard = createCloseGuard(new AppState(), docActions);

    const first = guard.confirmClose();
    // User hits ✕ again while the dialog is up.
    await expect(guard.confirmClose()).resolves.toBe(false);
    expect(docActions.confirmWindowClose).toHaveBeenCalledTimes(1);

    gate.resolve(true);
    await expect(first).resolves.toBe(true);
  });

  it('accepts a fresh request once the previous one settled', async () => {
    const docActions = makeDocActions(async () => false);
    const guard = createCloseGuard(new AppState(), docActions);

    await guard.confirmClose();
    await guard.confirmClose();
    expect(docActions.confirmWindowClose).toHaveBeenCalledTimes(2);
  });

  it('does not leave the guard stuck when the gate throws', async () => {
    const docActions = makeDocActions(async () => {
      throw new Error('dialog exploded');
    });
    const guard = createCloseGuard(new AppState(), docActions);

    await expect(guard.confirmClose()).rejects.toThrow('dialog exploded');
    // The pending flag must have been cleared, or every later close would
    // be refused and the window could never be closed again.
    await expect(guard.confirmClose()).rejects.toThrow('dialog exploded');
    expect(docActions.confirmWindowClose).toHaveBeenCalledTimes(2);
  });
});
