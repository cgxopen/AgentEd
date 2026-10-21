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
const { documentPageColour, setupWindowReports } = await import('./window-reports');

let pageColour = '#f7f3ed';
const themeListeners: Array<() => void> = [];

function wire(): {
  state: InstanceType<typeof AppState>;
  rename: (name: string) => void;
  showFailure: ReturnType<typeof vi.fn>;
} {
  const state = new AppState();
  const listeners: Array<(name: string) => void> = [];
  const showFailure = vi.fn();
  setupWindowReports(state, (cb) => listeners.push(cb), showFailure, {
    read: () => pageColour,
    onChange: (cb) => themeListeners.push(cb),
  });
  const rename = (name: string): void => {
    for (const cb of listeners) cb(name);
  };
  return { state, rename, showFailure };
}

beforeEach(() => {
  reports.length = 0;
  starters.length = 0;
  themeListeners.length = 0;
  pageColour = '#f7f3ed';
  failNext = false;
});

describe('what a window reports once it is one of several (#559)', () => {
  it('an empty Untitled window never edited reports itself untouched', async () => {
    wire();
    for (const start of starters) start();
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual({
      title: 'Untitled',
      unsaved: false,
      untouched: true,
      background: '#f7f3ed',
    });
  });

  it('reports again when the document is named and when it changes', async () => {
    const { state, rename } = wire();
    for (const start of starters) start();
    state.filePath = '/d/a.md';
    rename('a.md');
    state.setModified(true);
    await vi.waitFor(() => expect(reports).toHaveLength(3));
    expect(reports[1]).toMatchObject({ title: 'a.md', unsaved: false, untouched: false });
    expect(reports[2]).toMatchObject({ title: 'a.md', unsaved: true, untouched: false });
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

describe('the colour of the page, for the next window the process shows (#645)', () => {
  it('a report carries the page colour as the stylesheet resolves it', async () => {
    pageColour = '#000000';
    wire();
    for (const start of starters) start();
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]?.background).toBe('#000000');
  });

  it('a change of theme is reported again with the new colour', async () => {
    wire();
    for (const start of starters) start();
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    pageColour = '#1a1a1a';
    for (const cb of themeListeners) cb();
    await vi.waitFor(() => expect(reports).toHaveLength(2));
    expect(reports[1]?.background).toBe('#1a1a1a');
  });

  it('the page colour is --bg on <html>, and a change of data-theme is told', async () => {
    const root = document.documentElement;
    root.style.setProperty('--bg', '#123456');
    expect(documentPageColour.read()).toBe('#123456');
    const told = vi.fn();
    documentPageColour.onChange(told);
    root.setAttribute('data-theme', 'oled');
    await vi.waitFor(() => expect(told).toHaveBeenCalled());
    root.style.removeProperty('--bg');
    root.removeAttribute('data-theme');
  });
});
