/**
 * #791 - the size of the window, and whether it was maximized, remembered for
 * the machine and given before the show (owner decisions of 2026-11-24).
 *
 * **Said first: what a window looks like is not observable here.** That the
 * first frame has the size, that a maximized window is maximized from its first
 * frame, and where Windows places a window are seen on the screen: measured
 * under X11 on the pull request, and owed to the owner on Windows. These rows
 * hold the page half: which calls are made on the window, in which order
 * against the show, with what values, and what is written when.
 *
 * The window is the real adapter of `src/platform/index.ts` over a stand-in of
 * `@tauri-apps/api/window` that records each call, and the show is the real
 * `invoke` of `show_window_themed`, recorded in the same list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import defaultCapability from '../../src-tauri/capabilities/default.json';
import documentCapability from '../../src-tauri/capabilities/document-windows.json';
import tauriConf from '../../src-tauri/tauri.conf.json';
import { loadWindowSize, saveWindowSize, WINDOW_SIZE_KEY } from '../preferences';
import { type RememberedSize, WINDOW_LEAST, WINDOW_OF_TODAY, WRITE_DELAY_MS } from './window-size';

/** Every call made on the window and the show, in order. */
const calls: string[] = [];
/** A call to fail, by its name, to hold that the show is asked all the same. */
let failing: string | null = null;

interface Screen {
  work: { x: number; y: number; width: number; height: number };
  scale: number;
  /** Where the window stands once its size is set, in physical pixels. */
  at: { x: number; y: number };
}
let screen: Screen;
let maximized = false;
let fullscreen = false;
let inner = { width: 1024, height: 768 };
let resized: (() => void) | null = null;

function record(name: string, detail = ''): void {
  calls.push(detail ? name + ' ' + detail : name);
  if (failing === name) throw new Error(name + ' refused');
}

const own = {
  setSize: async (size: { width: number; height: number }) => {
    record('setSize', size.width + 'x' + size.height + ' ' + size.constructor.name);
    inner = { width: size.width, height: size.height };
    vi.stubGlobal('innerWidth', size.width);
    vi.stubGlobal('innerHeight', size.height);
  },
  outerPosition: async () => {
    record('outerPosition');
    return screen.at;
  },
  outerSize: async () => ({
    width: Math.round(inner.width * screen.scale),
    height: Math.round(inner.height * screen.scale),
  }),
  center: async () => record('center'),
  maximize: async () => {
    record('maximize');
    maximized = true;
    vi.stubGlobal('innerWidth', screen.work.width / screen.scale);
    vi.stubGlobal('innerHeight', screen.work.height / screen.scale);
  },
  isMaximized: async () => maximized,
  isFullscreen: async () => fullscreen,
  onResized: async (listener: () => void) => {
    record('onResized');
    resized = listener;
    return () => {
      resized = null;
    };
  },
};

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => own,
  currentMonitor: async () => {
    record('currentMonitor');
    return {
      scaleFactor: screen.scale,
      workArea: {
        position: { x: screen.work.x, y: screen.work.y },
        size: { width: screen.work.width, height: screen.work.height },
      },
    };
  },
  LogicalSize: class LogicalSize {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  },
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => record(command)),
}));

async function start(isTauri = true): Promise<void> {
  vi.doMock('./detect', () => ({ isTauri }));
  const { showWindowOnceSized } = await import('./index');
  await showWindowOnceSized(loadWindowSize, saveWindowSize);
}

function store(value: unknown): void {
  localStorage.setItem(WINDOW_SIZE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

const stored = (): RememberedSize | null => {
  const raw = localStorage.getItem(WINDOW_SIZE_KEY);
  return raw === null ? null : (JSON.parse(raw) as RememberedSize);
};

/** The calls made before the show, the show included. */
const beforeShow = () => calls.slice(0, calls.indexOf('show_window_themed') + 1);

beforeEach(() => {
  calls.length = 0;
  failing = null;
  maximized = false;
  fullscreen = false;
  inner = { width: 1024, height: 768 };
  resized = null;
  screen = { work: { x: 0, y: 0, width: 1920, height: 1040 }, scale: 1, at: { x: 26, y: 26 } };
  localStorage.clear();
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 768);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.doUnmock('./detect');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the size given before the show (#791)', () => {
  it('row 1: a size stored and valid is set before the show is asked, as a LogicalSize, once', async () => {
    store({ width: 1400, height: 900, maximized: false });
    await start();
    expect(beforeShow()).toEqual([
      'currentMonitor',
      'setSize 1400x900 LogicalSize',
      'outerPosition',
      'show_window_themed',
    ]);
    expect(calls.filter((c) => c.startsWith('setSize'))).toHaveLength(1);
  });

  it('row 2: nothing stored: nothing is asked of the window before the show, as on main', async () => {
    await start();
    expect(beforeShow()).toEqual(['show_window_themed']);
  });

  it('row 3: not JSON, not numbers, under the least window, larger than the work area: nothing set, the window of today', async () => {
    const cannotHold: unknown[] = [
      'not json',
      '[1400, 900]',
      { width: '1400', height: 900, maximized: false },
      { width: 1400, height: 900 },
      { width: 599, height: 900, maximized: false },
      { width: 1400, height: 399, maximized: false },
      { width: 1921, height: 900, maximized: false },
      { width: 1400, height: 1041, maximized: false },
    ];
    for (const value of cannotHold) {
      calls.length = 0;
      vi.resetModules();
      store(value);
      await start();
      expect(
        calls.some((c) => c.startsWith('setSize')),
        String(value),
      ).toBe(false);
      expect(calls).toContain('show_window_themed');
    }
  });

  it('row 3: the work area is read in logical pixels: at 150 per cent a size fits by its logical width', async () => {
    screen.work = { x: 0, y: 0, width: 2880, height: 1560 };
    screen.scale = 1.5;
    store({ width: 1920, height: 1040, maximized: false });
    await start();
    expect(calls).toContain('setSize 1920x1040 LogicalSize');
    vi.resetModules();
    calls.length = 0;
    store({ width: 1921, height: 1040, maximized: false });
    await start();
    expect(calls.some((c) => c.startsWith('setSize'))).toBe(false);
  });

  it('row 4: stored maximized with a valid size: the size, then maximize, then the show', async () => {
    store({ width: 1400, height: 900, maximized: true });
    await start();
    expect(beforeShow()).toEqual([
      'currentMonitor',
      'setSize 1400x900 LogicalSize',
      'outerPosition',
      'maximize',
      'show_window_themed',
    ]);
  });

  it('row 4: stored maximized with no valid size: maximize over the window of today', async () => {
    store({ width: 300, height: 200, maximized: true });
    await start();
    expect(beforeShow()).toEqual(['maximize', 'show_window_themed']);
  });

  it('row 5: a window that would run past its work area is centred before the show; one that is whole is not moved', async () => {
    store({ width: 1800, height: 1000, maximized: false });
    screen.at = { x: 200, y: 100 };
    await start();
    expect(beforeShow()).toEqual([
      'currentMonitor',
      'setSize 1800x1000 LogicalSize',
      'outerPosition',
      'center',
      'show_window_themed',
    ]);
    vi.resetModules();
    calls.length = 0;
    screen.at = { x: 60, y: 20 };
    await start();
    expect(calls).not.toContain('center');
  });

  it('row 5: past the left or the top edge counts too, and on a second monitor its own work area is the measure', async () => {
    store({ width: 1000, height: 700, maximized: false });
    screen.work = { x: 1920, y: 0, width: 1920, height: 1040 };
    screen.at = { x: 1900, y: 10 };
    await start();
    expect(calls).toContain('center');
    vi.resetModules();
    calls.length = 0;
    screen.at = { x: 2000, y: 10 };
    await start();
    expect(calls).not.toContain('center');
  });
});

describe('the size written as the person leaves it (#791)', () => {
  it('row 6: a resize writes the size once, 500 ms after the last event, not at each', async () => {
    vi.useFakeTimers();
    await start();
    expect(WRITE_DELAY_MS).toBe(500);
    for (const width of [1100, 1200, 1300]) {
      vi.stubGlobal('innerWidth', width);
      resized?.();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(stored()).toBeNull();
    const writes = vi.spyOn(localStorage, 'setItem');
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual({ width: 1300, height: 768, maximized: false });
  });

  it('row 7: while maximized or in full screen no size is written; the flag of maximized is written at each change', async () => {
    vi.useFakeTimers();
    store({ width: 1400, height: 900, maximized: false });
    await start();
    vi.stubGlobal('innerWidth', 1920);
    vi.stubGlobal('innerHeight', 1040);
    maximized = true;
    resized?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toEqual({ width: 1400, height: 900, maximized: true });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(stored()).toEqual({ width: 1400, height: 900, maximized: true });

    localStorage.clear();
    maximized = false;
    fullscreen = true;
    resized?.();
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(stored()).toBeNull();
  });

  it('row 8: restored from maximized, the size written is the restored one', async () => {
    vi.useFakeTimers();
    store({ width: 1400, height: 900, maximized: true });
    await start();
    vi.stubGlobal('innerWidth', 1920);
    vi.stubGlobal('innerHeight', 1040);
    resized?.();
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(stored()).toEqual({ width: 1400, height: 900, maximized: true });
    // The restore: the window goes back to the size set before it.
    maximized = false;
    vi.stubGlobal('innerWidth', 1400);
    vi.stubGlobal('innerHeight', 900);
    resized?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toEqual({ width: 1400, height: 900, maximized: false });
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(stored()).toEqual({ width: 1400, height: 900, maximized: false });
  });

  it('row 8: a window shown maximized with no size stored keeps the window of today for its restore', async () => {
    vi.useFakeTimers();
    store({ width: 1, height: 1, maximized: true });
    await start();
    maximized = false;
    resized?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toEqual({ ...WINDOW_OF_TODAY, maximized: false });
  });
});

describe('no failure keeps the window hidden (#791)', () => {
  it('row 9: each call failing in turn, the show is still asked, and a warning is in the console', async () => {
    store({ width: 1800, height: 1000, maximized: true });
    screen.at = { x: 200, y: 100 };
    for (const name of ['currentMonitor', 'setSize', 'outerPosition', 'center', 'maximize']) {
      calls.length = 0;
      vi.resetModules();
      failing = name;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await start();
      expect(calls, name).toContain('show_window_themed');
      expect(warn, name).toHaveBeenCalled();
      warn.mockRestore();
    }
  });

  it('row 9: a store that cannot be read: the show is asked, the window of today, a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    await start();
    expect(beforeShow()).toEqual(['show_window_themed']);
    expect(warn).toHaveBeenCalled();
  });

  it('row 10: the web build: nothing is read, set or written', async () => {
    store({ width: 1400, height: 900, maximized: true });
    const reads = vi.spyOn(localStorage, 'getItem');
    const writes = vi.spyOn(localStorage, 'setItem');
    await start(false);
    expect(calls).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('what is stored, and the files it is held to (#791)', () => {
  it('row 11: the key, its three fields and their unit, CSS pixels as the page measures itself', async () => {
    vi.useFakeTimers();
    await start();
    vi.stubGlobal('innerWidth', 1333.4);
    resized?.();
    await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
    expect(WINDOW_SIZE_KEY).toBe('agented:window-size');
    expect(stored()).toEqual({ width: 1333, height: 768, maximized: false });
    expect(Object.keys(stored() ?? {})).toEqual(['width', 'height', 'maximized']);
  });

  it('the least window and the window of today are those of the window descriptions', () => {
    const main = tauriConf.app.windows.find((w) => w.label === 'main');
    expect({ width: main?.minWidth, height: main?.minHeight }).toEqual(WINDOW_LEAST);
    expect({ width: main?.width, height: main?.height }).toEqual(WINDOW_OF_TODAY);
  });

  it('row 12: the capability files hold the three permissions, and the window permissions are those and no other', () => {
    const windowPermissions = (capability: { permissions: unknown[] }) =>
      capability.permissions.filter(
        (p): p is string => typeof p === 'string' && p.startsWith('core:window:'),
      );
    const expected = [
      'core:window:allow-destroy',
      'core:window:allow-set-size',
      'core:window:allow-maximize',
      'core:window:allow-center',
    ];
    expect(windowPermissions(defaultCapability)).toEqual(expected);
    expect(windowPermissions(documentCapability)).toEqual(expected);
    expect(documentCapability.permissions).toEqual(defaultCapability.permissions);
  });
});
