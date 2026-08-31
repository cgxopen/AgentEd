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
    onCodeBlock: vi.fn(),
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

  it('Ctrl+Shift+K makes a code block rather than falling through to nowhere', () => {
    // Asserted at the binding rather than in a comment (#204). This used to
    // assert the opposite — that the handler returned and left the event
    // unclaimed — with a comment beside the return saying the code block took
    // it. Nothing did: the README promised the shortcut, the one handler that
    // saw it declined, and it reached no one.
    const event = press({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true });

    expect(handlers.onCodeBlock).toHaveBeenCalledTimes(1);
    expect(handlers.onLink).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('takes Ctrl+Shift+K on a layout that reports another character for K', () => {
    press({ key: 'ĸ', code: 'KeyK', ctrlKey: true, shiftKey: true });
    expect(handlers.onCodeBlock).toHaveBeenCalledTimes(1);
  });

  it('leaves Ctrl+K to the link dialog, which is the neighbour being changed', () => {
    // The early return that used to decline Shift is gone, so both sides of
    // the branch it guarded are pinned: with Shift the block, without it the
    // link, and neither reaching the other.
    press({ key: 'k', code: 'KeyK', ctrlKey: true });

    expect(handlers.onLink).toHaveBeenCalledTimes(1);
    expect(handlers.onCodeBlock).not.toHaveBeenCalled();
  });

  it('claims neither on Shift+K with no Ctrl', () => {
    press({ key: 'K', code: 'KeyK', shiftKey: true });

    expect(handlers.onCodeBlock).not.toHaveBeenCalled();
    expect(handlers.onLink).not.toHaveBeenCalled();
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
