/**
 * The size of the window, and whether it was maximized, remembered for the
 * machine (#791, owner decisions of 2026-11-24, before and after the step
 * zero). The position is not remembered: the window stands where the system
 * puts it, and is moved only when it would not be whole.
 *
 * **Everything happens before the show.** Every window is made hidden and
 * shown by its page once the theme is applied (#639, #645, #648), so the page
 * sets the size, centres a window that would run past its screen, and
 * maximizes, before it asks for the show. Measured on the step zero under X11:
 * a size set so is the size of the first visible frame, and a window
 * maximized so is maximized from its first frame and restores to the size set
 * before it. Windows and macOS are owed to the hand of the owner.
 *
 * **No failure keeps the window hidden.** Each call is awaited in turn and the
 * first that fails ends the steps; `showWindowOnceSized` in `index.ts` tells it
 * to the console and asks for the show whatever happened here, and the
 * fallback of `src-tauri/src/window_shown.rs` stays the last answer.
 */

/**
 * The least window, `minWidth` and `minHeight` of every window description in
 * `src-tauri/tauri.*.conf.json`: a stored size under it is not a size the
 * window can take, and gives the window of today.
 */
export const WINDOW_LEAST = { width: 600, height: 400 } as const;

/**
 * The window of today, `width` and `height` of the same descriptions. It is
 * the size a restore goes back to when a window was maximized before any size
 * was stored, so it is what is written beside the flag then.
 */
export const WINDOW_OF_TODAY = { width: 1024, height: 768 } as const;

/**
 * How long after the last resize the size is written (owner decision on the
 * step zero of #791): a drag fires a resize each frame, and the store both
 * windows of two processes share is written once at its end rather than at
 * every frame. What a sudden end of the process loses is at most this much of
 * a drag.
 */
export const WRITE_DELAY_MS = 500;

/** What is remembered: the size in CSS pixels, the logical pixels of the window. */
export interface RememberedSize {
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}

/** A rectangle of the screen, in physical pixels, as the system answers it. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The few calls this module makes on its window, so that a test drives them
 * without the process. `tauriWindow` in `src/platform/index.ts` answers them
 * with `@tauri-apps/api/window`.
 */
export interface SizedWindow {
  /** The work area of the monitor of the window, and its scale; null when none is known. */
  monitor(): Promise<{ readonly work: ScreenRect; readonly scale: number } | null>;
  /** Set the inner size, in logical pixels. */
  setSize(width: number, height: number): Promise<void>;
  /** Where the window stands, frame included, in physical pixels. */
  outer(): Promise<ScreenRect>;
  center(): Promise<void>;
  maximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  /** The inner size the page measures itself at, in CSS pixels. */
  innerSize(): { readonly width: number; readonly height: number };
  /** Run `listener` at each resize; answers the function that stops it. */
  onResized(listener: () => void): Promise<() => void>;
}

/** Whether a stored size can be taken at all: at least the least window. */
function isTakeable(stored: RememberedSize): boolean {
  return stored.width >= WINDOW_LEAST.width && stored.height >= WINDOW_LEAST.height;
}

/** Whether a logical size fits inside the work area of a monitor. */
function fitsIn(
  size: { readonly width: number; readonly height: number },
  work: ScreenRect,
  scale: number,
): boolean {
  return size.width <= work.width / scale && size.height <= work.height / scale;
}

/** Whether a rectangle runs past the work area on any edge. */
function runsPast(rect: ScreenRect, work: ScreenRect): boolean {
  return (
    rect.x < work.x ||
    rect.y < work.y ||
    rect.x + rect.width > work.x + work.width ||
    rect.y + rect.height > work.y + work.height
  );
}

/**
 * The size a restore goes back to for a window shown maximized: the stored
 * size when the window can take it, or the window of today.
 */
export function keptSize(stored: RememberedSize | null): { width: number; height: number } {
  return stored !== null && isTakeable(stored)
    ? { width: stored.width, height: stored.height }
    : { ...WINDOW_OF_TODAY };
}

/**
 * Give the window its remembered size before the show: the size when it is
 * valid and fits the work area of its monitor, then a centring when the window
 * would run past that area, then maximize when that was stored. A size that
 * cannot hold gives the window of today; maximized is applied over it all the
 * same. Nothing stored asks nothing of the window. The first call that fails
 * rejects, and the caller shows the window all the same.
 *
 * **Where the place read before the show is the place**: on Windows the
 * window is created at its place while hidden (read in `tao` 0.37.1), which is
 * the case the centring is for. Under X11 a hidden window reports no place yet,
 * 0, 0 and 0 x 0, measured on #791 under openbox, so nothing is centred there,
 * and the window manager places the window when it is shown, whole in every
 * size measured.
 */
export async function applyRememberedSize(
  stored: RememberedSize | null,
  window: SizedWindow,
): Promise<void> {
  if (stored === null) return;
  if (isTakeable(stored)) {
    const monitor = await window.monitor();
    if (monitor && fitsIn(stored, monitor.work, monitor.scale)) {
      await window.setSize(stored.width, stored.height);
      if (runsPast(await window.outer(), monitor.work)) await window.center();
    }
  }
  if (stored.maximized) await window.maximize();
}

/**
 * Write the size as the person leaves it: `WRITE_DELAY_MS` after the last
 * resize, and only while the window is neither maximized nor in full screen,
 * so the size kept is the size a restore goes back to. Maximized is written at
 * each of its changes, beside the last size kept. `kept` is the size a restore
 * goes back to for a window shown maximized: the stored one, or the window of
 * today.
 */
export async function watchWindowSize(
  window: SizedWindow,
  save: (size: RememberedSize) => void,
  kept: { readonly width: number; readonly height: number },
): Promise<() => void> {
  let maximized = await window.isMaximized();
  const inner = window.innerSize();
  let size = maximized
    ? { width: kept.width, height: kept.height }
    : { width: Math.round(inner.width), height: Math.round(inner.height) };
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function writeSize(): Promise<void> {
    timer = null;
    if ((await window.isMaximized()) || (await window.isFullscreen())) return;
    const inner = window.innerSize();
    size = { width: Math.round(inner.width), height: Math.round(inner.height) };
    save({ ...size, maximized: false });
  }

  async function resized(): Promise<void> {
    const now = await window.isMaximized();
    if (now !== maximized && !(await window.isFullscreen())) {
      maximized = now;
      save({ ...size, maximized });
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      writeSize().catch((e: unknown) => console.warn('[window] the size was not written:', e));
    }, WRITE_DELAY_MS);
  }

  const stop = await window.onResized(() => {
    resized().catch((e: unknown) => console.warn('[window] a resize was not read:', e));
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    stop();
  };
}
