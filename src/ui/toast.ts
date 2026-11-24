export type ToastKind = 'info' | 'warn' | 'error';

/**
 * How long a toast stays before it fades: long enough to read it, by the count
 * of its words (#779, owner decision of 2026-11-24, a start to be judged by
 * hand on Windows). Words are counted by white space, so a path with no space
 * counts as one word.
 */

/** Every toast stays this long at least: the time each of them had before #779. */
export const TOAST_MIN_MS = 3000;

/**
 * The words read within that minimum: about three seconds at 200 words a
 * minute, an ordinary pace of reading on a screen.
 */
export const TOAST_WORDS_IN_MIN = 10;

/** Past those, each further group of this many words adds a second: 240 words a minute. */
export const TOAST_WORDS_PER_SECOND = 4;

/**
 * No toast stays longer: it stands over a corner of the window and nothing
 * dismisses it, so a long message is read in this time or opened elsewhere.
 */
export const TOAST_MAX_MS = 10_000;

/** The fade after that time, as before #779. */
export const TOAST_FADE_MS = 250;

/** How long a toast carrying `message` stays before it fades. */
export function toastDuration(message: string): number {
  const words = message.split(/\s+/).filter((word) => word.length > 0).length;
  const groups = Math.floor(Math.max(0, words - TOAST_WORDS_IN_MIN) / TOAST_WORDS_PER_SECOND);
  return Math.min(TOAST_MAX_MS, TOAST_MIN_MS + groups * 1000);
}

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a transient toast message in the top-right corner. It hides after the
 * time `toastDuration` gives its words, from 3 s to 10 s, then fades in
 * `TOAST_FADE_MS`; several stand stacked, each leaving at its own time.
 */
export function showToast(message: string, kind: ToastKind = 'info'): void {
  const c = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  c.appendChild(toast);

  // Trigger CSS transition
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, toastDuration(message));
}
