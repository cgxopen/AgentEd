/**
 * Hover switches between sections once one is open (#362, owner decision of
 * 2026-09-18). The first press on a header opens it, as ever; while a section
 * is open, the pointer resting on another header switches to it after a delay.
 *
 * It never opens or closes the menu, and it never opens a section of a menu
 * with none open: it only moves between sections. Nothing here reaches the
 * keyboard.
 *
 * **A switch starts only from the pointer moving onto a header, never from a
 * header sliding under a pointer that stands still.** A switch folds one
 * section and opens another, which moves every header below, so a new header
 * can arrive under a still pointer; if that started a switch, one switch could
 * start the next. Measured in Chromium 153 on the built page, with the pointer
 * resting on an entry of Edit while Edit folded: the header that slid under it
 * received `pointerover` and `pointerenter`, at the same coordinates, and **no
 * `pointermove`**. So the delay is armed by `pointermove` alone, and only by
 * one whose coordinates differ from the last one seen, which also refuses a
 * synthetic move an engine sends after layout without the pointer moving.
 * WebView2 is Chromium, so the same is expected there; the manual pass on
 * Windows is where that is verified.
 */

/** How long the pointer rests on a header before its section opens. Chosen on the branch. */
export const HOVER_SWITCH_DELAY_MS = 150;

/** A header and the panel it opens, as the menu reads them from the markup. */
export interface HoverSection {
  readonly header: HTMLElement;
  readonly panel: HTMLElement;
}

export interface HoverSwitch {
  /** Forget any switch waiting to happen; the menu calls it when it closes. */
  cancel(): void;
}

/**
 * Listen on `dropdown` for the pointer moving onto a header. `openSection` is
 * the switch the menu already makes on a press, and `openNow` answers which
 * section is open, or `null` when none is.
 */
export function installHoverSwitch(
  dropdown: HTMLElement,
  sections: readonly HoverSection[],
  openSection: (section: HoverSection) => void,
  openNow: () => HoverSection | null,
): HoverSwitch {
  let lastX: number | null = null;
  let lastY: number | null = null;
  let pending: { section: HoverSection; timer: ReturnType<typeof setTimeout> } | null = null;

  function cancel(): void {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  function arm(section: HoverSection): void {
    if (pending?.section === section) return;
    cancel();
    const timer = setTimeout(() => {
      pending = null;
      const open = openNow();
      if (open !== null && open !== section) openSection(section);
    }, HOVER_SWITCH_DELAY_MS);
    pending = { section, timer };
  }

  dropdown.addEventListener('pointermove', (e) => {
    const moved = e.clientX !== lastX || e.clientY !== lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!moved) return;
    const target = e.target as Node | null;
    const section = sections.find(({ header }) => target !== null && header.contains(target));
    const open = openNow();
    if (!section || open === null || open === section) {
      cancel();
      return;
    }
    arm(section);
  });

  // Crossing a header switches nothing: leaving it before the delay forgets it.
  for (const section of sections) {
    section.header.addEventListener('pointerleave', () => {
      if (pending?.section === section) cancel();
    });
  }

  return { cancel };
}
