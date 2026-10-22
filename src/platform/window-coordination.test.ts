import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoked: Array<[string, unknown]> = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: unknown) => {
    invoked.push([command, args]);
  }),
}));

type Module = typeof import('./window-coordination');
let coordination: Module;

beforeEach(async () => {
  invoked.length = 0;
  // A fresh module per case: a window starts uncoordinated.
  vi.resetModules();
  coordination = await import('./window-coordination');
});

const REPORT = { title: 'a.md', unsaved: true, untouched: false };

describe('a window among several, on macOS (#559)', () => {
  it('reports nothing and calls nothing until the process says so', async () => {
    // Windows and Linux never say so, and have no such commands.
    await coordination.reportWindowState(REPORT);
    await coordination.reportCloseCancelled();
    expect(invoked).toEqual([]);
  });

  it('reports its state and a kept-open close once coordinated', async () => {
    coordination.startCoordination();
    await coordination.reportWindowState(REPORT);
    await coordination.reportCloseCancelled();
    expect(invoked).toEqual([
      ['report_window_state', REPORT],
      ['window_close_cancelled', undefined],
    ]);
  });

  it('starts a waiting starter once, and a late one at once', () => {
    const early = vi.fn();
    coordination.onCoordinated(early);
    expect(early).not.toHaveBeenCalled();
    coordination.startCoordination();
    coordination.startCoordination();
    expect(early).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    coordination.onCoordinated(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
