import { hasDarkVersion, type ThemeManager } from '../app/theme-manager';
import type { PaletteName, ThemePreference } from '../preferences';

/**
 * Kebab (⋮) menu in the header that owns the Appearance controls —
 * Mode (Light / Dark / Auto) and Palette (Default / Paper Warm /
 * Solarized / GitHub). Extracted from the hamburger menu so Appearance
 * is one click away and the hamburger can stay lean for File/Edit/View.
 *
 * The two axes are independent: Mode is light/dark/auto, Palette is the
 * colour family. Solarized and GitHub follow the active mode; Paper
 * Warm is light-only. Which palettes have a dark version is the manager's
 * answer, not the menu's (#391): the menu is a pure view, all logic stays
 * in the manager. Persistence is unchanged (localStorage via
 * `ThemeManager`).
 *
 * Behaviour: click-to-apply with the popover staying open for quick
 * palette exploration; closes on click-outside, Escape, or a click on
 * any other header control (the capture-phase listener fires before
 * those controls' own `stopPropagation`, so popovers stay mutually
 * exclusive).
 */
export interface AppearanceMenu {
  /** Re-sync the active markers from the ThemeManager's current state. */
  refresh: () => void;
}

/**
 * The popover's `right`, inside the menubar, that puts its right edge on the
 * trigger's right edge (#330).
 *
 * The popover is a child of the menubar, which is the whole width of the
 * window, so `right` is the distance from the menubar's right edge — and the
 * trigger's own distance from it is exactly that. Before #330 the value was a
 * constant in the stylesheet, 12px, while the button sat 144px from the edge
 * behind a reservation for window controls that are not drawn in this webview:
 * the popover opened 132px to the right of the button that opened it, measured
 * in Chromium at 1200, 1024, 1000, 800 and 700px.
 *
 * **It is arithmetic on rectangles and nothing else**, because the harness
 * reports every rectangle as zero — `popover-placement.ts` is split the same
 * way and says so at greater length. What this returns is asserted directly;
 * that the number reaches the element, and the element is where the number
 * says, is the manual pass.
 */
export function popoverRight(menubarRight: number, triggerRight: number): number {
  return menubarRight - triggerRight;
}

/** The line under the Mode options while the palette has no dark version (#391). */
export const MODE_NOTE_ID = 'appearance-mode-note';

const MODE_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto (system)' },
];

const PALETTE_OPTIONS: ReadonlyArray<{
  value: PaletteName;
  label: string;
  swatch: string;
  title?: string;
}> = [
  {
    value: 'default',
    label: 'Default',
    swatch: 'linear-gradient(135deg, #ffffff 50%, #1a1a1a 50%)',
  },
  {
    value: 'paper',
    label: 'Paper Warm',
    swatch: '#f7f3ed',
    title: 'Warm palette, light mode only',
  },
  {
    value: 'solarized',
    label: 'Solarized',
    swatch: 'linear-gradient(135deg, #fdf6e3 50%, #002b36 50%)',
  },
  {
    value: 'github',
    label: 'GitHub',
    swatch: 'linear-gradient(135deg, #ffffff 50%, #0d1117 50%)',
  },
];

export function setupAppearanceMenu(themeManager: ThemeManager): AppearanceMenu {
  const button = document.getElementById('appearance-menu-trigger') as HTMLButtonElement | null;
  const popover = document.getElementById('appearance-popover') as HTMLElement | null;
  if (!button || !popover) {
    // Defensive: tests / partial mounts get a no-op handle.
    return { refresh: () => {} };
  }

  const modeButtons = new Map<ThemePreference, HTMLButtonElement>();
  const paletteButtons = new Map<PaletteName, HTMLButtonElement>();
  const modeNote = buildPopover(popover, modeButtons, paletteButtons, themeManager);

  function isOpen(): boolean {
    return !popover!.classList.contains('hidden');
  }

  function openPopover(): void {
    refresh();
    anchor();
    popover!.classList.remove('hidden');
    button!.setAttribute('aria-expanded', 'true');
  }

  /**
   * Put the popover's right edge on the trigger's, before it is shown.
   *
   * Read at every open rather than once: the trigger is the last child of a
   * group whose width follows the indicators beside it, so its position moves
   * with the document as well as with the window. A resize while the popover is
   * open leaves it where it opened — the same as the three popovers placed by
   * `popoverPlacement`, and the window controls of the frame are the way out of
   * an open popover on Windows anyway. Without a menubar there is nothing to
   * measure against and the stylesheet's resting value stands.
   */
  function anchor(): void {
    const menubar = document.getElementById('menubar');
    if (!menubar) return;
    const right = popoverRight(
      menubar.getBoundingClientRect().right,
      button!.getBoundingClientRect().right,
    );
    popover!.style.right = `${right}px`;
  }

  function closePopover(): void {
    popover!.classList.add('hidden');
    button!.setAttribute('aria-expanded', 'false');
  }

  /**
   * Marks the mode the page is in rather than the one stored (#391): under a
   * palette with no dark version that is Light, while the stored Dark or Auto
   * waits for a palette that has one. Dark and Auto are disabled there, which
   * takes them out of the Tab order as the greyed menu entries are, and the
   * line saying why is shown and read out on Light, the option that is
   * selected.
   */
  function refresh(): void {
    const mode = themeManager.getEffectiveMode();
    const palette = themeManager.getPalette();
    const modeApplies = hasDarkVersion(palette);
    for (const [value, el] of modeButtons) {
      el.classList.toggle('active', value === mode);
      el.disabled = !modeApplies && value !== 'light';
    }
    modeNote.hidden = modeApplies;
    modeNote.textContent = modeApplies ? '' : `${paletteLabel(palette)} has no dark version.`;
    const light = modeButtons.get('light');
    if (modeApplies) light?.removeAttribute('aria-describedby');
    else light?.setAttribute('aria-describedby', MODE_NOTE_ID);
    for (const [value, el] of paletteButtons) {
      el.classList.toggle('active', value === palette);
    }
  }

  // No stopPropagation here: letting the click bubble closes the
  // cluster popover, so opening this menu makes the header popovers
  // mutually exclusive in this direction too.
  button.addEventListener('click', () => {
    if (isOpen()) closePopover();
    else openPopover();
  });

  // Capture phase so this fires *before* other header controls call
  // `stopPropagation` in their bubble handlers — clicking the cluster
  // indicator still closes this popover.
  document.addEventListener(
    'click',
    (e) => {
      if (!isOpen()) return;
      const target = e.target as Node;
      if (popover!.contains(target)) return; // interacting with the menu
      if (button!.contains(target)) return; // the button's own toggle handles it
      closePopover();
    },
    true,
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closePopover();
  });

  // Keep in sync if the mode/palette change from elsewhere.
  themeManager.onModeChange(() => refresh());
  themeManager.onPaletteChange(() => refresh());

  refresh();
  return { refresh };
}

function buildPopover(
  popover: HTMLElement,
  modeButtons: Map<ThemePreference, HTMLButtonElement>,
  paletteButtons: Map<PaletteName, HTMLButtonElement>,
  themeManager: ThemeManager,
): HTMLElement {
  popover.replaceChildren();

  popover.appendChild(sectionLabel('Mode'));
  for (const opt of MODE_OPTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'appearance-option appearance-mode';
    item.dataset.mode = opt.value;
    item.textContent = opt.label;
    item.addEventListener('click', () => {
      themeManager.setMode(opt.value);
    });
    modeButtons.set(opt.value, item);
    popover.appendChild(item);
  }

  const modeNote = document.createElement('div');
  modeNote.id = MODE_NOTE_ID;
  modeNote.className = 'appearance-note';
  modeNote.hidden = true;
  popover.appendChild(modeNote);

  popover.appendChild(sectionLabel('Palette'));
  for (const opt of PALETTE_OPTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'appearance-option appearance-palette';
    item.dataset.palette = opt.value;
    if (opt.title) item.title = opt.title;

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = opt.swatch;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(opt.label));

    item.addEventListener('click', () => {
      themeManager.setPalette(opt.value);
    });
    paletteButtons.set(opt.value, item);
    popover.appendChild(item);
  }
  return modeNote;
}

/** The name a palette is shown under in the popover. */
function paletteLabel(palette: PaletteName): string {
  return PALETTE_OPTIONS.find((opt) => opt.value === palette)?.label ?? palette;
}

function sectionLabel(text: string): HTMLElement {
  const label = document.createElement('div');
  label.className = 'appearance-section-label';
  label.textContent = text;
  return label;
}
