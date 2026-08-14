import type { ThemeManager } from '../app/theme-manager';
import type { PaletteName, ThemePreference } from '../preferences';

/**
 * Kebab (⋮) menu in the header that owns the Appearance controls —
 * Mode (Light / Dark / Auto) and Palette (Default / Claude Warm /
 * Solarized / GitHub). Extracted from the hamburger menu so Appearance
 * is one click away and the hamburger can stay lean for File/Edit/View.
 *
 * The two axes are independent: Mode is light/dark/auto, Palette is the
 * colour family. Solarized and GitHub follow the active mode; Claude
 * Warm is light-only. This mirrors `ThemeManager` exactly — the menu is
 * a pure view, all logic stays in the manager. Persistence is unchanged
 * (localStorage via `ThemeManager`).
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
    value: 'claude',
    label: 'Claude Warm',
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
  buildPopover(popover, modeButtons, paletteButtons, themeManager);

  function isOpen(): boolean {
    return !popover!.classList.contains('hidden');
  }

  function openPopover(): void {
    refresh();
    popover!.classList.remove('hidden');
    button!.setAttribute('aria-expanded', 'true');
  }

  function closePopover(): void {
    popover!.classList.add('hidden');
    button!.setAttribute('aria-expanded', 'false');
  }

  function refresh(): void {
    const mode = themeManager.getMode();
    const palette = themeManager.getPalette();
    for (const [value, el] of modeButtons) {
      el.classList.toggle('active', value === mode);
    }
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
): void {
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

  popover.appendChild(divider());
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
}

function sectionLabel(text: string): HTMLElement {
  const label = document.createElement('div');
  label.className = 'appearance-section-label';
  label.textContent = text;
  return label;
}

function divider(): HTMLElement {
  const hr = document.createElement('div');
  hr.className = 'appearance-divider';
  return hr;
}
