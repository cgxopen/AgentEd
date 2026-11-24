/**
 * #779 - how long a toast stays: by the count of its words, from 3 s to 10 s,
 * then the fade of 250 ms as before. Read with fake timers: the toast stands
 * in its container until its time, loses `toast-visible` then, and is removed
 * after the fade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELATIVE_LINK_MESSAGES } from '../app/relative-link';
import {
  showToast,
  TOAST_FADE_MS,
  TOAST_MAX_MS,
  TOAST_MIN_MS,
  TOAST_WORDS_IN_MIN,
  TOAST_WORDS_PER_SECOND,
  toastDuration,
} from './toast';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

beforeEach(() => {
  vi.useFakeTimers();
  document.getElementById('toast-container')?.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Each toast standing, by its text, and whether it is still drawn visible. */
function standing(): Array<[string, boolean]> {
  return Array.from(document.querySelectorAll<HTMLElement>('#toast-container .toast')).map((t) => [
    t.textContent ?? '',
    t.classList.contains('toast-visible'),
  ]);
}

/** Show `message` and say when it stops being visible, in ms after it was shown. */
function leavesAt(message: string): number {
  showToast(message);
  vi.advanceTimersToNextFrame();
  let at = 0;
  // Bounded: the ceiling is 10 s, read in steps of 100 ms.
  while (standing().some(([text, visible]) => text === message && visible) && at <= 20_000) {
    vi.advanceTimersByTime(100);
    at += 100;
  }
  return at;
}

describe('the figures, each a named constant (owner decision of 2026-11-24)', () => {
  it('at least 3 s, ten words in it, a second for each 4 words past them, at most 10 s', () => {
    expect([TOAST_MIN_MS, TOAST_WORDS_IN_MIN, TOAST_WORDS_PER_SECOND, TOAST_MAX_MS]).toEqual([
      3000, 10, 4, 10_000,
    ]);
  });
});

describe('a toast stays as long as its words ask (#779)', () => {
  it('row 11: a toast of ten words or fewer leaves at 3 s, as on main', () => {
    expect(toastDuration('Saved.')).toBe(3000);
    expect(toastDuration(words(10))).toBe(3000);
    expect(leavesAt(words(10))).toBe(3000);
  });

  it('row 12: a toast of 18 words leaves at 5 s', () => {
    expect(toastDuration(words(18))).toBe(5000);
    expect(leavesAt(words(18))).toBe(5000);
  });

  it('row 13: the new rooted message leaves at 10 s, and one of 200 words at 10 s too, the ceiling', () => {
    expect(RELATIVE_LINK_MESSAGES.rooted.split(/\s+/).length).toBe(42);
    expect(leavesAt(RELATIVE_LINK_MESSAGES.rooted)).toBe(10_000);
    expect(toastDuration(words(200))).toBe(10_000);
  });

  it('a path with no space counts as one word, and stays the minimum', () => {
    expect(toastDuration(`Could not open ${'a'.repeat(300)}.pdf.`)).toBe(3000);
  });

  it('row 14: two toasts of different lengths each leave at their own time', () => {
    const long = words(42);
    const short = words(5);
    showToast(long);
    showToast(short);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersByTime(3000);
    expect(standing().find(([t]) => t === short)?.[1]).toBe(false);
    expect(standing().find(([t]) => t === long)?.[1]).toBe(true);
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(standing().map(([t]) => t)).toEqual([long]);
    vi.advanceTimersByTime(10_000 - 3000 - TOAST_FADE_MS);
    expect(standing()).toEqual([[long, false]]);
  });

  it('row 15: the fade of 250 ms after the time is as on main', () => {
    expect(TOAST_FADE_MS).toBe(250);
    showToast('Copied.');
    // Timed from the moment it is shown: visible from the next frame to 3 s.
    vi.advanceTimersByTime(2999);
    expect(standing()).toEqual([['Copied.', true]]);
    vi.advanceTimersByTime(1);
    expect(standing()).toEqual([['Copied.', false]]);
    vi.advanceTimersByTime(249);
    expect(standing()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(standing()).toEqual([]);
  });
});
