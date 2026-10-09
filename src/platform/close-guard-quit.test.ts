/**
 * #559 - a window kept open by its gate says so, so that a quit asking the
 * windows of macOS one at a time stops there. The gate and `installCloseGuard`
 * are the real ones; the window is a stand-in that raises the close request
 * the way Tauri does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloseGuard } from './types';

interface CloseEvent {
  preventDefault(): void;
}
let listener: ((event: CloseEvent) => Promise<void>) | null = null;
const destroy = vi.fn(async () => {});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(async (l: (event: CloseEvent) => Promise<void>) => {
      listener = l;
      return () => {};
    }),
    destroy,
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({}));
const reportCloseCancelled = vi.fn(async () => {});
vi.mock('./window-coordination', () => ({ reportCloseCancelled }));

const { TauriIO } = await import('./tauri');

async function closeWith(confirmClose: CloseGuard['confirmClose']): Promise<void> {
  await new TauriIO().installCloseGuard({ hasUnsavedChanges: () => true, confirmClose });
  await listener?.({ preventDefault() {} });
}

beforeEach(() => {
  listener = null;
  vi.clearAllMocks();
});

describe('a window kept open tells the quit (#559)', () => {
  it('Cancel keeps the window and says so', async () => {
    await closeWith(async () => false);
    expect(destroy).not.toHaveBeenCalled();
    expect(reportCloseCancelled).toHaveBeenCalledTimes(1);
  });

  it('a gate that fails keeps the window and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await closeWith(async () => {
      throw new Error('gate');
    });
    expect(destroy).not.toHaveBeenCalled();
    expect(reportCloseCancelled).toHaveBeenCalledTimes(1);
  });

  it('an approved close destroys the window and says nothing', async () => {
    await closeWith(async () => true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(reportCloseCancelled).not.toHaveBeenCalled();
  });
});
