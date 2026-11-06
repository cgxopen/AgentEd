/**
 * #701 - Help, Keyboard Shortcuts and Help, User Guide open a window of their
 * own. These rows hold the page half: what it asks the process, what a web
 * tab carries, and what a window opened for a help is told. The process half
 * is held in `src-tauri/src/help_window.rs`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() =>
  vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => null),
);
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./detect');
  vi.restoreAllMocks();
  invoke.mockReset();
  window.history.replaceState(null, '', '/');
});

async function platform(isTauri: boolean): Promise<typeof import('./index')> {
  vi.doMock('./detect', () => ({ isTauri }));
  return await import('./index');
}

describe('the desktop build asks the process (#701)', () => {
  it('to open the help named, by the command the process registers', async () => {
    const { openHelpWindow } = await platform(true);
    await openHelpWindow('guide');
    expect(invoke).toHaveBeenCalledWith('open_help_window', { name: 'guide' });
  });

  it('a refusal of the process reaches the caller, which says it', async () => {
    invoke.mockRejectedValueOnce('the help window did not start');
    const { openHelpWindow } = await platform(true);
    await expect(openHelpWindow('shortcuts')).rejects.toBe('the help window did not start');
  });

  it.each([
    ['shortcuts', 'shortcuts'],
    ['guide', 'guide'],
    [null, null],
    ['about', null],
  ])('the help this window holds: %s gives %s', async (answer, expected) => {
    invoke.mockResolvedValueOnce(answer);
    const { takeLaunchHelp } = await platform(true);
    expect(await takeLaunchHelp()).toBe(expected);
    expect(invoke).toHaveBeenCalledWith('take_launch_help');
  });
});

describe('the web build opens a tab (#701)', () => {
  it('the page again, with the help named in its query, and asks no process', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { openHelpWindow } = await platform(false);
    await openHelpWindow('shortcuts');
    expect(open).toHaveBeenCalledWith('/?help=shortcuts', '_blank');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a tab the browser did not open is said, not lost', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { openHelpWindow } = await platform(false);
    await expect(openHelpWindow('guide')).rejects.toThrow('did not open a new tab');
  });

  it.each([
    ['?help=guide', 'guide'],
    ['?help=shortcuts', 'shortcuts'],
    ['?help=../notes.md', null],
    ['', null],
  ])('a tab with the query %s holds %s', async (query, expected) => {
    window.history.replaceState(null, '', `/${query}`);
    const { takeLaunchHelp } = await platform(false);
    expect(await takeLaunchHelp()).toBe(expected);
  });
});
