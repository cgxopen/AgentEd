/**
 * The width of the files panel, dragged by hand at its edge on the side of
 * the document (#786, owner decisions of 2026-11-24, before and after the step
 * zero). The rows of the panel stay as they are; only the room for a name, an
 * address or a sentence changes.
 *
 * **Nothing widens on its own.** The one thing done without a person is the
 * other way: in a window too small for the chosen width the panel gives way as
 * far as it must, and returns to the chosen width when the window has room
 * again. Giving way writes nothing, so the chosen width is not forgotten.
 *
 * **One listener of the window**, for its size, since the most depends on the
 * window. A drag listens on the edge alone, and on the window for its focus
 * only while it lasts.
 */

/** The least width, and the width of every panel before #786. */
export const SIDEBAR_MIN_WIDTH = 220;

/**
 * The text column the editor keeps at least beside a panel made wider: the
 * owner decision of 2026-11-24, after a step zero that measured 480 px of text
 * at the most of the default window of 1024 px.
 */
export const TEXT_MIN_WIDTH = 480;

/**
 * What stands beside the panel and the text in the width of the window: the
 * margin of the panel, 8 px on its side away from the document, and the 40 px
 * on each side of the editor, read from `#sidebar` and `#editor` in
 * `src/styles.css`. Typed here, and held to the stylesheet by
 * `src/ui/sidebar-width.test.ts`, so a change there turns that test red.
 */
export const BESIDE_THE_TEXT = 8 + 40 + 40;

/** The most is at most this share of the window. */
export const MOST_SHARE_OF_WINDOW = 0.5;

/** An arrow key moves the edge by this much. */
export const KEY_STEP = 16;

/** With Shift held, an arrow key moves the edge by this much. */
export const KEY_STEP_WITH_SHIFT = 64;

/**
 * The most the panel may take in a window `windowWidth` wide: half the window,
 * and never so much that the text column falls under `TEXT_MIN_WIDTH`. Under
 * about 790 px of window this is the least, and nothing widens.
 */
export function maxSidebarWidth(windowWidth: number): number {
  const half = Math.floor(windowWidth * MOST_SHARE_OF_WINDOW);
  const leavingText = windowWidth - BESIDE_THE_TEXT - TEXT_MIN_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(half, leavingText));
}

/** `width` held between the least and the most of a window `windowWidth` wide. */
export function clampSidebarWidth(width: number, windowWidth: number): number {
  return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), maxSidebarWidth(windowWidth));
}

export const SIDEBAR_EDGE_LABEL = 'Width of the files panel';
export const SIDEBAR_EDGE_CLASS = 'sidebar-resize';
export const SIDEBAR_EDGE_DRAGGING_CLASS = 'dragging';

export interface SidebarWidthDeps {
  /** The width remembered, or null when nothing usable is stored. */
  readonly load: () => number | null;
  readonly save: (width: number) => void;
  /** The width of the window; the window itself unless a test stands in. */
  readonly windowWidth?: () => number;
  /** Told after a width is applied, at most once a frame: the floating toolbar places itself again. */
  readonly onApplied?: () => void;
}

export interface SidebarWidth {
  /** The width a person chose, which the panel shows when the window has room for it. */
  chosen: () => number;
  /** The width the panel has now. */
  shown: () => number;
  /** Remove the edge and the listener of the window, leaving nothing behind. */
  dispose: () => void;
}

export function setupSidebarWidth(panel: HTMLElement, deps: SidebarWidthDeps): SidebarWidth {
  const windowWidth = deps.windowWidth ?? (() => window.innerWidth);
  const stored = deps.load();
  // A stored width under the least, or no width, is the least; one above the
  // most is shown at the most and kept as stored, for a wider window.
  let chosen = stored === null ? SIDEBAR_MIN_WIDTH : Math.max(SIDEBAR_MIN_WIDTH, stored);
  let shown = SIDEBAR_MIN_WIDTH;

  const edge = document.createElement('div');
  edge.className = SIDEBAR_EDGE_CLASS;
  edge.setAttribute('role', 'separator');
  edge.setAttribute('aria-orientation', 'vertical');
  edge.setAttribute('aria-label', SIDEBAR_EDGE_LABEL);
  edge.tabIndex = 0;
  panel.prepend(edge);

  let frame = 0;
  function told(): void {
    if (!deps.onApplied || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      deps.onApplied?.();
    });
  }

  /** Draw the width chosen, or what the window leaves of it. */
  function apply(): void {
    const width = windowWidth();
    shown = Math.min(chosen, maxSidebarWidth(width));
    panel.style.width = `${shown}px`;
    edge.setAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH));
    edge.setAttribute('aria-valuemax', String(maxSidebarWidth(width)));
    edge.setAttribute('aria-valuenow', String(shown));
    told();
  }

  function choose(width: number): void {
    chosen = clampSidebarWidth(width, windowWidth());
    apply();
  }

  let drag: {
    readonly pointerId: number;
    readonly startX: number;
    readonly startWidth: number;
  } | null = null;

  /** End a drag however it ends: a release, a capture lost, or the window losing focus. */
  function endDrag(): void {
    if (drag === null) return;
    if (edge.hasPointerCapture?.(drag.pointerId)) edge.releasePointerCapture(drag.pointerId);
    drag = null;
    edge.classList.remove(SIDEBAR_EDGE_DRAGGING_CLASS);
    window.removeEventListener('blur', endDrag);
    deps.save(chosen);
  }

  edge.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // No focus taken, no selection started: the press is the edge's alone.
    event.preventDefault();
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: shown };
    edge.setPointerCapture?.(event.pointerId);
    edge.classList.add(SIDEBAR_EDGE_DRAGGING_CLASS);
    window.addEventListener('blur', endDrag);
  });
  edge.addEventListener('pointermove', (event) => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // The edge stands on the side of the document: moving it that way widens.
    choose(drag.startWidth + (drag.startX - event.clientX));
  });
  edge.addEventListener('pointerup', endDrag);
  edge.addEventListener('pointercancel', endDrag);
  edge.addEventListener('lostpointercapture', endDrag);

  edge.addEventListener('dblclick', () => {
    choose(SIDEBAR_MIN_WIDTH);
    deps.save(chosen);
  });

  edge.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? KEY_STEP_WITH_SHIFT : KEY_STEP;
    if (event.key === 'ArrowLeft') choose(shown + step);
    else if (event.key === 'ArrowRight') choose(shown - step);
    else if (event.key === 'Home') choose(SIDEBAR_MIN_WIDTH);
    else if (event.key === 'End') choose(maxSidebarWidth(windowWidth()));
    else return;
    event.preventDefault();
    deps.save(chosen);
  });

  window.addEventListener('resize', apply);
  apply();

  return {
    chosen: () => chosen,
    shown: () => shown,
    dispose: () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('blur', endDrag);
      if (frame !== 0) cancelAnimationFrame(frame);
      edge.remove();
      panel.style.width = '';
    },
  };
}
