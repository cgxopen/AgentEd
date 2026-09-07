/**
 * #184 — the grant capability, reached without a member on `PlatformIO`.
 *
 * Two halves that fail for opposite reasons. On the web it must actually
 * ask and report what came back; on the desktop it must answer `false`
 * without asking anything, because the line that calls it is drawn only
 * where a panel is absent for want of a grant — and that never happens
 * there. A desktop implementation would be dead code (#146's shape).
 *
 * `getPlatformIO` caches its answer in a module-level binding, so each
 * half needs its own module registry: `vi.resetModules` before the
 * dynamic import is what gives it one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TAURI = '__TAURI_INTERNALS__';

// Hoisted, and at the top level so the order on the page is the order at
// run time. The desktop half imports `tauri.ts`, which pulls the plugins.
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  stat: vi.fn(),
  exists: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[TAURI];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('on the web', () => {
  it('asks for a folder and answers true when one is given', async () => {
    const picked = { name: 'proiect', getFileHandle: async () => ({}) };
    vi.stubGlobal(
      'showDirectoryPicker',
      vi.fn(async () => picked),
    );
    const { requestFolderAccess } = await import('./index');

    await expect(requestFolderAccess()).resolves.toBe(true);
    expect(window.showDirectoryPicker).toHaveBeenCalledTimes(1);
  });

  it('answers false when the picker is cancelled, and says nothing about it', async () => {
    // `acquireDirectoryHandle` swallows `AbortError` by design, so the
    // handle is unchanged and this is the value that keeps the caller
    // silent (#61).
    const abort = () => {
      throw new DOMException('cancelled', 'AbortError');
    };
    vi.stubGlobal('showDirectoryPicker', vi.fn(abort));
    const { requestFolderAccess } = await import('./index');

    await expect(requestFolderAccess()).resolves.toBe(false);
  });
});

describe('on the desktop', () => {
  it('answers false without asking anything', async () => {
    (globalThis as unknown as Record<string, unknown>)[TAURI] = {};
    const picker = vi.fn();
    vi.stubGlobal('showDirectoryPicker', picker);
    const { requestFolderAccess } = await import('./index');

    await expect(requestFolderAccess()).resolves.toBe(false);
    expect(picker).not.toHaveBeenCalled();
  });
});
