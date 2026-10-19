/**
 * #615 - which window the platform reports as having its title bar over the
 * header: the answer of `title_bar_overlay` in `src-tauri/src/title_bar.rs`,
 * read from the config of the window, whose rows in Rust hold the answer for
 * each target. These rows hold what the page does with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { answer, invoke, fakeWindow } = vi.hoisted(() => {
  const answer = { value: true as boolean | Error };
  const invoke = vi.fn(async (command: string) => {
    if (command !== 'title_bar_overlay') throw new Error(`unexpected command ${command}`);
    if (answer.value instanceof Error) throw answer.value;
    return answer.value;
  });
  const fakeWindow = {
    fullscreen: false,
    isFullscreen: vi.fn(async () => fakeWindow.fullscreen),
    onResized: vi.fn(async (_listener: () => void) => () => {}),
  };
  return { answer, invoke, fakeWindow };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => fakeWindow }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { titleBarOverlay as titleBarOverlayOnWeb } from './index';
import { titleBarOverlay } from './tauri';

beforeEach(() => {
  answer.value = true;
  fakeWindow.fullscreen = false;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the window whose title bar is over the header (#615)', () => {
  it('is handed over where the config says so, with its full screen and its resizes', async () => {
    const overlay = await titleBarOverlay();
    if (!overlay) throw new Error('a window with the overlay style should be handed over');
    expect(await overlay.fullscreen()).toBe(false);
    fakeWindow.fullscreen = true;
    expect(await overlay.fullscreen()).toBe(true);

    const listener = () => {};
    overlay.onResize(listener);
    expect(fakeWindow.onResized).toHaveBeenCalledWith(listener);
  });

  it('is none where the config keeps the title bar apart: Windows and Linux', async () => {
    answer.value = false;
    expect(await titleBarOverlay()).toBeNull();
  });

  it('is none, and said in the console, where the answer fails', async () => {
    answer.value = new Error('no window description for `settings`');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await titleBarOverlay()).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('is none on the web build, which has no window to ask', async () => {
    // The harness is web-shaped: `isTauri` is false.
    expect(await titleBarOverlayOnWeb()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
