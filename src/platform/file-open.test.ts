import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const handlers = new Map<string, (event: { payload: string }) => void>();
let held: string | null = null;

// The window's own listener (#559): on macOS a document is sent to the one
// window that is to open it. A listener installed through the app-wide
// `listen` would hear every window's documents, so that module is not even
// mocked here, and a regression to it fails on the import.
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(async (name: string, handler: (event: { payload: string }) => void) => {
      calls.push(`listen ${name}`);
      handlers.set(name, handler);
      return () => {};
    }),
  }),
}));

vi.mock('@tauri-apps/api/event', () => {
  throw new Error('the app-wide listen hears every window; use the window listener');
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    calls.push(`invoke ${command}`);
    return held;
  }),
}));

const startCoordination = vi.fn();
vi.mock('./window-coordination', () => ({ startCoordination }));

const { listenForFileOpen } = await import('./file-open');

describe('listenForFileOpen (#541, #559)', () => {
  beforeEach(() => {
    calls.length = 0;
    handlers.clear();
    held = null;
    startCoordination.mockClear();
  });

  it('installs both of the window listeners before it asks for the held path', async () => {
    await listenForFileOpen(() => {});
    expect(calls).toEqual([
      'listen file-open',
      'listen window-coordination',
      'invoke take_pending_file_open',
    ]);
  });

  it('opens the path a launch was asked to open, once', async () => {
    held = '/Users/me/My Notes/a.md';
    const opened: string[] = [];
    await listenForFileOpen((path) => opened.push(path));
    expect(opened).toEqual(['/Users/me/My Notes/a.md']);
  });

  it('opens nothing at start-up when nothing is held', async () => {
    const opened: string[] = [];
    await listenForFileOpen((path) => opened.push(path));
    expect(opened).toEqual([]);
  });

  it('opens a path that arrives afterwards, while AgentEd runs', async () => {
    const opened: string[] = [];
    await listenForFileOpen((path) => opened.push(path));
    handlers.get('file-open')?.({ payload: '/Users/me/b.md' });
    expect(opened).toEqual(['/Users/me/b.md']);
  });

  it('starts reporting when the process says the window is one of several', async () => {
    await listenForFileOpen(() => {});
    expect(startCoordination).not.toHaveBeenCalled();
    handlers.get('window-coordination')?.({ payload: '' });
    expect(startCoordination).toHaveBeenCalledTimes(1);
  });
});
