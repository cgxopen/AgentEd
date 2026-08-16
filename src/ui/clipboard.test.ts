import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

const originalClipboard = navigator.clipboard;

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('writes the text and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyText('AgentEd 0.2.0 (a1b2c3d)')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('AgentEd 0.2.0 (a1b2c3d)');
  });

  it('reports failure instead of throwing when the write is refused', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    await expect(copyText('anything')).resolves.toBe(false);
  });

  it('survives a platform with no clipboard API at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await expect(copyText('anything')).resolves.toBe(false);
  });

  it('does not put an empty string on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyText('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
