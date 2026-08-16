import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type KeyboardHandlers, setupKeyboard } from './keyboard';

let handlers: KeyboardHandlers;

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  handlers = {
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onOpen: vi.fn(),
    onLink: vi.fn(),
  };
  setupKeyboard(handlers);
});

describe('Ctrl+K opens the link dialog', () => {
  it('fires on Ctrl+K', () => {
    const event = press({ key: 'k', code: 'KeyK', ctrlKey: true });

    expect(handlers.onLink).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('fires on Cmd+K', () => {
    press({ key: 'k', code: 'KeyK', metaKey: true });
    expect(handlers.onLink).toHaveBeenCalledTimes(1);
  });

  it('fires on a layout that reports another character for the K key', () => {
    press({ key: 'ĸ', code: 'KeyK', ctrlKey: true });
    expect(handlers.onLink).toHaveBeenCalledTimes(1);
  });

  it('leaves Ctrl+Shift+K to the code block', () => {
    const event = press({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true });

    expect(handlers.onLink).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores K with no modifier', () => {
    press({ key: 'k', code: 'KeyK' });
    expect(handlers.onLink).not.toHaveBeenCalled();
  });
});

describe('the shortcuts that were already there', () => {
  it('still saves on Ctrl+S', () => {
    press({ key: 's', ctrlKey: true });
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(handlers.onLink).not.toHaveBeenCalled();
  });

  it('still saves as on Ctrl+Shift+S', () => {
    press({ key: 's', ctrlKey: true, shiftKey: true });
    expect(handlers.onSaveAs).toHaveBeenCalledTimes(1);
  });

  it('still opens on Ctrl+O', () => {
    press({ key: 'o', ctrlKey: true });
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
  });
});
