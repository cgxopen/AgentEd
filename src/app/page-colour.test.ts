/**
 * Issue #648 - the colour of the page reaches the process on its own, on
 * every platform: when the theme is applied and whenever it changes.
 *
 * What the process does with it, drawing the next window in it before its
 * page paints, is not observable here; it is measured under Xvfb on Linux and
 * seen by the owner on each platform (#646, #648).
 */
import { describe, expect, it, vi } from 'vitest';
import { documentPageColour, setupPageColour } from './page-colour';

function wire(initial: string) {
  let colour = initial;
  const listeners: Array<() => void> = [];
  const kept: string[] = [];
  const keep = vi.fn(async (c: string) => {
    kept.push(c);
  });
  setupPageColour({ read: () => colour, onChange: (cb) => listeners.push(cb) }, keep);
  const change = (next: string): void => {
    colour = next;
    for (const cb of listeners) cb();
  };
  return { kept, change, keep };
}

describe('the colour of the page, told to the process (#648)', () => {
  it('tells the colour at once, without waiting for anything else', () => {
    const { kept } = wire('#f7f3ed');
    expect(kept).toEqual(['#f7f3ed']);
  });

  it('tells it again with the new colour on a change of theme', () => {
    const { kept, change } = wire('#f7f3ed');
    change('#000');
    expect(kept).toEqual(['#f7f3ed', '#000']);
  });

  it('a failed report is logged and does not throw', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const keep = vi.fn(async () => {
      throw new Error('no process');
    });
    expect(() => setupPageColour({ read: () => '#000', onChange: () => {} }, keep)).not.toThrow();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    error.mockRestore();
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
