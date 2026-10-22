import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowReport } from '../platform/window-coordination';

const reports: WindowReport[] = [];
let failNext = false;
const starters: Array<() => void> = [];

vi.mock('../platform/window-coordination', () => ({
  onCoordinated: (start: () => void) => starters.push(start),
  reportWindowState: vi.fn(async (report: WindowReport) => {
    if (failNext) throw new Error('lost');
    reports.push(report);
  }),
}));

const { AppState } = await import('./state');
const { setupWindowReports } = await import('./window-reports');

function wire(): {
  state: InstanceType<typeof AppState>;
  rename: (name: string) => void;
  showFailure: ReturnType<typeof vi.fn>;
} {
  const state = new AppState();
  const listeners: Array<(name: string) => void> = [];
  const showFailure = vi.fn();
  setupWindowReports(state, (cb) => listeners.push(cb), showFailure);
  const rename = (name: string): void => {
    for (const cb of listeners) cb(name);
  };
  return { state, rename, showFailure };
}

beforeEach(() => {
  reports.length = 0;
  starters.length = 0;
  failNext = false;
});

describe('what a window reports once it is one of several (#559)', () => {
  it('an empty Untitled window never edited reports itself untouched', async () => {
    wire();
    for (const start of starters) start();
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual({ title: 'Untitled', unsaved: false, untouched: true });
  });

  it('reports again when the document is named and when it changes', async () => {
    const { state, rename } = wire();
    for (const start of starters) start();
    state.filePath = '/d/a.md';
    rename('a.md');
    state.setModified(true);
    await vi.waitFor(() => expect(reports).toHaveLength(3));
    expect(reports[1]).toEqual({ title: 'a.md', unsaved: false, untouched: false });
    expect(reports[2]).toEqual({ title: 'a.md', unsaved: true, untouched: false });
  });

  it('an Untitled document with typed text is not untouched', async () => {
    const { state } = wire();
    state.setModified(true);
    for (const start of starters) start();
    await vi.waitFor(() => expect(reports.at(-1)?.untouched).toBe(false));
    expect(reports.at(-1)?.unsaved).toBe(true);
  });

  it('a failed report is shown once, not on every keystroke', async () => {
    const { state, showFailure } = wire();
    for (const start of starters) start();
    failNext = true;
    state.setModified(true);
    state.setModified(false);
    state.setModified(true);
    await vi.waitFor(() => expect(showFailure).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(showFailure).toHaveBeenCalledTimes(1);
  });
});
