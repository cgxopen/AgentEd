import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../ui/toast';
import { createCloseGuard, SAVING_CLOSE_MESSAGE } from './close-guard';
import type { DocumentActions } from './document-actions';
import { AppState } from './state';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

function makeDocActions(confirmWindowClose: () => Promise<boolean>): DocumentActions {
  return {
    handleNew: vi.fn(async () => {}),
    handleNewFromTemplate: vi.fn(async () => {}),
    handleOpen: vi.fn(async () => {}),
    handleSave: vi.fn(async () => {}),
    handleSaveAs: vi.fn(async () => {}),
    handleClose: vi.fn(async () => {}),
    openFilePath: vi.fn(async () => {}),
    openRecentFile: vi.fn(async () => {}),
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
  beforeEach(() => {
    vi.mocked(showToast).mockClear();
  });

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

  describe('a save in flight', () => {
    /** A guard whose document is mid-write, plus the state to release it. */
    function midSave(): {
      guard: ReturnType<typeof createCloseGuard>;
      state: AppState;
      docActions: DocumentActions;
    } {
      const state = new AppState();
      state.isSaving = true;
      const docActions = makeDocActions(async () => true);
      return { guard: createCloseGuard(state, docActions), state, docActions };
    }

    it('keeps the window open without opening the gate', async () => {
      const { guard, docActions } = midSave();

      await expect(guard.confirmClose()).resolves.toBe(false);
      expect(docActions.confirmWindowClose).not.toHaveBeenCalled();
    });

    it('tells the user why the window did not close', async () => {
      const { guard } = midSave();
      await guard.confirmClose();
      expect(showToast).toHaveBeenCalledWith(SAVING_CLOSE_MESSAGE);
    });

    it('answers every ✕ rather than queueing the close', async () => {
      const { guard } = midSave();
      await guard.confirmClose();
      await guard.confirmClose();
      expect(showToast).toHaveBeenCalledTimes(2);
    });

    it('leaves nothing behind once the save completes', async () => {
      const { guard, state, docActions } = midSave();

      await expect(guard.confirmClose()).resolves.toBe(false);

      state.isSaving = false;
      await expect(guard.confirmClose()).resolves.toBe(true);
      expect(docActions.confirmWindowClose).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('says nothing when no save is running', async () => {
      const guard = createCloseGuard(
        new AppState(),
        makeDocActions(async () => true),
      );
      await guard.confirmClose();
      expect(showToast).not.toHaveBeenCalled();
    });

    it('leaves the silent re-entrancy refusal alone', async () => {
      const gate = deferred();
      const docActions = makeDocActions(() => gate.promise);
      const guard = createCloseGuard(new AppState(), docActions);

      const first = guard.confirmClose();
      await expect(guard.confirmClose()).resolves.toBe(false);
      // The dialog on screen is its own explanation.
      expect(showToast).not.toHaveBeenCalled();

      gate.resolve(true);
      await expect(first).resolves.toBe(true);
    });
  });
});
