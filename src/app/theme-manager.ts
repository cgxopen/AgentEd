import {
  loadPalettePreference,
  loadThemePreference,
  type PaletteName,
  savePalettePreference,
  saveThemePreference,
  type ThemePreference,
} from '../preferences';

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Each palette and the `data-theme` value it is drawn with in light and in
 * dark, `null` meaning the bare `:root` block. A palette with no dark version
 * has `null` for dark and is drawn with its light value in every mode.
 *
 * One table, so the value set on the page and the answer the Appearance menu
 * is given come from the same place and cannot disagree (#391).
 */
const PALETTE_THEMES: Readonly<
  Record<PaletteName, { readonly light: string | null; readonly dark: string | null }>
> = {
  default: { light: null, dark: 'dark' },
  paper: { light: 'paper', dark: null },
  solarized: { light: 'solarized-light', dark: 'solarized-dark' },
  github: { light: 'github-light', dark: 'github-dark' },
};

/** Whether a palette has a dark version, so the mode reaches it (#391). */
export function hasDarkVersion(palette: PaletteName): boolean {
  return PALETTE_THEMES[palette].dark !== null;
}

/**
 * Applies the active theme to `<html>` via the `data-theme` attribute.
 * The attribute value composes two independent axes:
 *   - `mode`: Light / Dark / Auto (mirrors OS preference in Auto)
 *   - `palette`: Default / Paper Warm / Solarized / GitHub
 *
 * Which palettes have a dark version is answered here, from `PALETTE_THEMES`,
 * and nowhere else (#391): Default, Solarized and GitHub honor the mode, and
 * Paper Warm exists in light only, so it produces `data-theme="paper"`
 * whatever the mode. The stored mode is never changed by a palette: under
 * Paper Warm it waits, and the palette left for one with a dark version finds
 * it again.
 *
 * Listeners (menu palette + mode radios) are notified via onChange.
 */
export class ThemeManager {
  private mode: ThemePreference;
  private palette: PaletteName;
  private mql: MediaQueryList | null = null;
  private modeListeners: Array<(p: ThemePreference) => void> = [];
  private paletteListeners: Array<(p: PaletteName) => void> = [];

  constructor() {
    this.mode = loadThemePreference();
    this.palette = loadPalettePreference();
    this.apply();
    if (this.mode === 'auto') this.watchSystem();
  }

  getMode(): ThemePreference {
    return this.mode;
  }

  getPalette(): PaletteName {
    return this.palette;
  }

  /**
   * The mode the page is actually in, as the Appearance menu marks it: the
   * stored mode, except under a palette with no dark version, where the page
   * is light whatever was chosen (#391). The stored mode is left as it is.
   */
  getEffectiveMode(): ThemePreference {
    return hasDarkVersion(this.palette) ? this.mode : 'light';
  }

  setMode(pref: ThemePreference): void {
    this.mode = pref;
    saveThemePreference(pref);
    this.apply();
    if (pref === 'auto') this.watchSystem();
    else this.unwatchSystem();
    for (const cb of this.modeListeners) cb(pref);
  }

  setPalette(p: PaletteName): void {
    this.palette = p;
    savePalettePreference(p);
    this.apply();
    for (const cb of this.paletteListeners) cb(p);
  }

  onModeChange(cb: (p: ThemePreference) => void): void {
    this.modeListeners.push(cb);
  }

  onPaletteChange(cb: (p: PaletteName) => void): void {
    this.paletteListeners.push(cb);
  }

  private apply(): void {
    const value = this.computeDataTheme();
    if (value) {
      document.documentElement.setAttribute('data-theme', value);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  /** Build the `data-theme` attribute value from current mode + palette. */
  private computeDataTheme(): string | null {
    const themes = PALETTE_THEMES[this.palette];
    if (themes.dark === null) return themes.light;
    return this.resolveMode() === 'dark' ? themes.dark : themes.light;
  }

  private resolveMode(): 'light' | 'dark' {
    if (this.mode === 'auto') {
      return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
    }
    return this.mode;
  }

  private watchSystem(): void {
    if (this.mql) return;
    this.mql = window.matchMedia(MEDIA_QUERY);
    this.mql.addEventListener('change', this.onSystemChange);
  }

  private unwatchSystem(): void {
    if (!this.mql) return;
    this.mql.removeEventListener('change', this.onSystemChange);
    this.mql = null;
  }

  private onSystemChange = (): void => {
    if (this.mode === 'auto') this.apply();
  };
}
