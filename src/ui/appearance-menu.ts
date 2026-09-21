import { missingMode, type ThemeManager } from '../app/theme-manager';
import type { PaletteName, ThemePreference } from '../preferences';

/**
 * Kebab (⋮) menu in the header that owns the Appearance controls —
 * Mode (Light / Dark / Auto) and Palette (Default / Paper Warm /
 * Solarized / OLED Black). Extracted from the hamburger menu so Appearance
 * is one click away and the hamburger can stay lean for File/Edit/View.
 *
 * The two axes are independent: Mode is light/dark/auto, Palette is the
 * colour family. Default and Solarized follow the active mode; Paper Warm
 * is light only and OLED Black dark only. Which modes a palette has is the
 * manager's answer, not the menu's (#391, #398): the menu is a pure view,
 * all logic stays in the manager, and it names no palette of its own.
 * Persistence is unchanged (localStorage via `ThemeManager`).
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
    // Split like the others, and its second half is the palette accent rather
    // than a night colour, since there is no dark version for it to show
    // (#391, owner decision of 2026-09-19 on captures of four candidates).
    swatch: 'linear-gradient(135deg, #f7f3ed 50%, #b8653f 50%)',
    title: 'Warm palette, light mode only',
  },
  {
    value: 'solarized',
    label: 'Solarized',
    swatch: 'linear-gradient(135deg, #fdf6e3 50%, #002b36 50%)',
  },
  {
    value: 'oled',
    label: 'OLED Black',
    // Its page and its accent, the rule Paper Warm follows: a palette with one
    // version shows that version rather than a day and a night half (#391).
    swatch: 'linear-gradient(135deg, #000000 50%, #6cb6ff 50%)',
    // The claim is measured rather than asserted (#398), on the owner's OLED
    // laptop at his everyday brightness, **against Default in Light**: four
    // phases of five minutes, alternated, the battery read every five
    // seconds. **About 750 mW less, 13 per cent of a 4950 mW draw**, and the
    // two Default phases landed 27 mW apart, so the figure stands well clear
    // of the drift between them. The estimate from the remaining capacity is
    // larger, 1513 mW, and noisier; the figures and the protocol are on the
    // issue. **Against an already dark palette it is not measured**, and the
    // sentence names the comparison rather than leaving it open (owner
    // decision of 2026-09-20): `#1a1a1a` emits 1.03 per cent of what a white
    // page emits, so the page part of Default Dark is about 8 mW and the
    // difference from pure black is below the 27 mW the best run could
    // resolve. A sentence that said battery without saying against what
    // would have been read as a claim about that 8 mW. A five-minute run taken first could resolve
    // nothing: the battery driver holds one figure for tens of seconds.
    title: 'Pure black. On OLED, less power than a light palette.',
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
   * Marks the mode the page is in rather than the one stored (#391, #398):
   * under a palette that has one mode only that is the mode it has, while the
   * stored one waits for a palette that has both. The other two options are
   * disabled there, which takes them out of the Tab order as the greyed menu
   * entries are, and the line saying why is shown and read out on the option
   * that is selected.
   */
  function refresh(): void {
    const mode = themeManager.getEffectiveMode();
    const palette = themeManager.getPalette();
    const missing = missingMode(palette);
    for (const [value, el] of modeButtons) {
      el.classList.toggle('active', value === mode);
      el.disabled = missing !== null && value !== mode;
    }
    modeNote.hidden = missing === null;
    modeNote.textContent = missing === null ? '' : `No ${missing} version.`;
    for (const [value, el] of modeButtons) {
      if (missing !== null && value === mode) el.setAttribute('aria-describedby', MODE_NOTE_ID);
      else el.removeAttribute('aria-describedby');
    }
    for (const [value, el] of paletteButtons) {
      el.classList.toggle('active', value === palette);
    }
  }

  // No stopPropagation here: letting the click bubble closes the
  // «Images» popover, so opening this menu makes the header popovers
  // mutually exclusive in this direction too.
  button.addEventListener('click', () => {
    if (isOpen()) closePopover();
    else openPopover();
  });

  // Capture phase so this fires *before* other header controls call
  // `stopPropagation` in their bubble handlers — clicking the «Images»
  // badge still closes this popover.
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
  // Short on purpose (#391, owner decision on the artifact): it stands under
  // the greyed options while the palette is active, so it need not name it.
  // Its words are written by `refresh`, from the mode the palette lacks.
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

function sectionLabel(text: string): HTMLElement {
  const label = document.createElement('div');
  label.className = 'appearance-section-label';
  label.textContent = text;
  return label;
}
