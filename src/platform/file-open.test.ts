import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let fileOpenHandler: ((event: { payload: string }) => void) | null = null;
let held: string | null = null;

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: string }) => void) => {
    calls.push(`listen ${name}`);
    fileOpenHandler = handler;
    return () => {};
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    calls.push(`invoke ${command}`);
    return held;
  }),
}));

const { listenForFileOpen } = await import('./file-open');

describe('listenForFileOpen (#541)', () => {
  beforeEach(() => {
    calls.length = 0;
    fileOpenHandler = null;
    held = null;
  });

  it('installs the listener before it asks for the held path', async () => {
    await listenForFileOpen(() => {});
    expect(calls).toEqual(['listen file-open', 'invoke take_pending_file_open']);
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
    fileOpenHandler?.({ payload: '/Users/me/b.md' });
    expect(opened).toEqual(['/Users/me/b.md']);
  });
});
