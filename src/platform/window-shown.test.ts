/**
 * #639 - on Windows the main window is created hidden and shown once the page
 * has applied its theme. These rows hold the page half: the signal it sends,
 * when it sends it, and that the web build sends none. The Rust half, the
 * hidden window of `tauri.windows.conf.json` alone and the fallback after
 * 2 s, is held in `src-tauri/src/main.rs` and `window_shown.rs`.
 *
 * **Said first: what a window shows is not observable here.** That no white
 * frame reaches the screen was seen by the owner on Windows, on the installer
 * of the step zero; it is the owner pass on the artifact again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import mainSource from '../main.ts?raw';

const invoke = vi.hoisted(() => vi.fn(async (_command: string) => undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./detect');
  invoke.mockClear();
});

async function signal(isTauri: boolean): Promise<void> {
  vi.doMock('./detect', () => ({ isTauri }));
  const { showWindowOnceThemed } = await import('./index');
  await showWindowOnceThemed();
}

describe('the page tells the process its theme is applied (#639)', () => {
  it('the desktop build asks for its window once, by the command the process registers', async () => {
    await signal(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('show_window_themed');
  });

  it('the web build has no process to tell and sends nothing', async () => {
    await signal(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('the signal is sent as soon as the theme is on the page (#639)', () => {
  const at = (text: string) => mainSource.indexOf(text);

  it('right after the theme manager has set data-theme, before the file association', () => {
    const themed = at('const themeManager = new ThemeManager();');
    const shown = at('showWindowOnceThemed().catch(console.error);');
    expect(themed).toBeGreaterThan(-1);
    expect(shown).toBeGreaterThan(themed);
    // The document a launch was asked for waits for the page (#541); the
    // window does not wait for the document.
    expect(at('setupFileAssociation(')).toBeGreaterThan(shown);
  });

  it('is not awaited, so nothing of the start waits on it', () => {
    expect(mainSource).not.toContain('await showWindowOnceThemed');
  });
});
