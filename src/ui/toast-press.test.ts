/**
 * #782 - a press of the pointer anywhere in the window ends every toast that
 * stands, with its fade, and goes on to what it was aimed at; the press that
 * raised a toast does not end it. happy-dom does no hit testing, so that a
 * press over a toast reaches the control under it is held in two halves here
 * (the rule of the stylesheet, and a press on a control reaching its handler
 * while the toast leaves) and measured in Chromium on the pull request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLinkOpener } from '../app/link-open';
import { followRelativeLink, RELATIVE_LINK_MESSAGES } from '../app/relative-link';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { PlatformIO } from '../platform/types';
import stylesheet from '../styles.css?raw';
import { reaches, stylesheetRules } from '../test-support/stylesheet-rules';
import { showConfirmDialog } from './confirm-dialog';
import { showToast, TOAST_FADE_MS, toastDuration } from './toast';

const LONG = RELATIVE_LINK_MESSAGES.rooted;

function press(target: EventTarget): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
}

/** Each toast in the container, by its text, and whether it is drawn visible. */
function standing(): Array<[string, boolean]> {
  return Array.from(document.querySelectorAll<HTMLElement>('#toast-container .toast')).map((t) => [
    t.textContent ?? '',
    t.classList.contains('toast-visible'),
  ]);
}

function raise(message: string): void {
  showToast(message);
  vi.advanceTimersToNextFrame();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.getElementById('toast-container')?.replaceChildren();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.querySelector('.dialog-overlay')?.remove();
});

describe('a press ends every toast that stands (#782, owner decision of 2026-11-24)', () => {
  it('row 1: a press in the editor ends a toast, with the fade', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const instance: EditorInstance = createEditor(host);
    raise(LONG);
    press(instance.editor.view.dom);
    expect(standing()).toEqual([[LONG, false]]);
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(standing()).toEqual([]);
    instance.destroy();
    host.remove();
  });

  it('row 2: a press on a control reaches that control, and the toast leaves', () => {
    const control = document.createElement('button');
    const pressed = vi.fn();
    control.addEventListener('pointerdown', pressed);
    document.body.append(control);
    raise(LONG);
    press(control);
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(standing()).toEqual([[LONG, false]]);
    control.remove();
  });

  it('row 2, the other half: a toast and its container take no pointer, so a press over them goes under', () => {
    raise(LONG);
    const toast = document.querySelector('#toast-container .toast') as HTMLElement;
    const container = document.getElementById('toast-container') as HTMLElement;
    const pointer = (el: Element) =>
      stylesheetRules(stylesheet)
        .filter(
          (r) =>
            r.conditions.length === 0 &&
            reaches(r.selector, el) &&
            r.declarations.has('pointer-events'),
        )
        .map((r) => r.declarations.get('pointer-events'));
    expect(pointer(toast)).toEqual(['none']);
    expect(pointer(container)).toEqual(['none']);
  });

  it('row 3: two toasts stand; one press ends both', () => {
    raise(LONG);
    raise('Copied.');
    press(document.body);
    expect(standing()).toEqual([
      [LONG, false],
      ['Copied.', false],
    ]);
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(standing()).toEqual([]);
  });

  it('row 4: the press of Ctrl and a click that raises a toast leaves it standing; the next press ends it', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const instance = createEditor(host);
    instance.setMarkdown('[other](/other.md)\n');
    const stop = installLinkOpener(instance.editor.view.dom, {
      openExternal: async () => {},
      openRelative: (address) => {
        void followRelativeLink(
          {
            documentPath: () => '/notes/a.md',
            panelRoot: () => null,
            io: async () => ({}) as PlatformIO,
            openFilePath: async () => {},
          },
          address,
        );
      },
    });
    const link = instance.editor.view.dom.querySelector('a') as HTMLElement;
    // The gesture in the order a browser gives it: press, release, click.
    const mouse = (type: string) =>
      link.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          metaKey: true,
        }),
      );
    link.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true,
      }),
    );
    mouse('mousedown');
    mouse('mouseup');
    mouse('click');
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersToNextFrame();
    expect(standing()).toEqual([[LONG, true]]);
    press(instance.editor.view.dom);
    expect(standing()).toEqual([[LONG, false]]);
    stop();
    instance.destroy();
    host.remove();
  });

  it('row 5: with no press the toast leaves at the time of toastDuration, as on main', () => {
    showToast(LONG);
    vi.advanceTimersByTime(toastDuration(LONG) - 1);
    expect(standing()).toEqual([[LONG, true]]);
    vi.advanceTimersByTime(1);
    expect(standing()).toEqual([[LONG, false]]);
  });

  it('row 6: a toast ended by a press is removed once, and its timer does nothing afterwards', () => {
    raise(LONG);
    const before = vi.getTimerCount();
    press(document.body);
    // Its timer is cleared and one fade is set in its place.
    expect(vi.getTimerCount()).toBe(before);
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(standing()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // A toast raised next stands its whole time: nothing of the first fires on it.
    raise('After.');
    vi.advanceTimersByTime(toastDuration('After.') - 20);
    expect(standing()).toEqual([['After.', true]]);
  });

  it('row 7: a toast raised after a press, with none standing at that press, stays its whole time', () => {
    press(document.body);
    showToast(LONG);
    vi.advanceTimersByTime(toastDuration(LONG) - 1);
    expect(standing()).toEqual([[LONG, true]]);
  });

  it('row 8: a press inside an open dialog ends a toast behind it', () => {
    raise(LONG);
    void showConfirmDialog({
      title: 'Unsaved changes',
      message: 'x',
      actions: [{ label: 'Cancel', value: 'cancel' }],
    });
    const button = document.querySelector('.dialog-overlay button') as HTMLElement;
    press(button);
    expect(standing()).toEqual([[LONG, false]]);
  });
});

describe('where a toast stands and how it looks, as on main (#782)', () => {
  it('its place, width and colours', () => {
    const rules = stylesheetRules(stylesheet).filter((r) => r.conditions.length === 0);
    const of = (selector: string) => rules.find((r) => r.selector === selector)?.declarations;
    expect(of('#toast-container')?.get('top')).toBe('16px');
    expect(of('#toast-container')?.get('right')).toBe('16px');
    expect(of('.toast')?.get('max-width')).toBe('320px');
    expect(of('.toast')?.get('background')).toBe('var(--text)');
    expect(of('.toast')?.get('color')).toBe('var(--bg)');
  });
});
