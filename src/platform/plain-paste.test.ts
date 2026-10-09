import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, () => void>();
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(async (name: string, handler: () => void) => {
      handlers.set(name, handler);
      return () => {};
    }),
  }),
}));

const { listenForPlainPasteRequest } = await import('./plain-paste');
const { requestPlainPaste } = await import('../editor/paste');

describe('Paste and Match Style from the macOS Edit menu (#558)', () => {
  it('asks for a plain paste when this window is told one comes', async () => {
    const storage = { plainPasteRequestedAt: 0 };
    await listenForPlainPasteRequest(() => requestPlainPaste(storage));
    expect(storage.plainPasteRequestedAt).toBe(0);
    handlers.get('paste-as-plain-text')?.();
    expect(Date.now() - storage.plainPasteRequestedAt).toBeLessThan(1000);
  });
});
