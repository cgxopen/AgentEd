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
 * Applies the active theme to `<html>` via the `data-theme` attribute.
 * The attribute value composes two independent axes:
 *   - `mode`: Light / Dark / Auto (mirrors OS preference in Auto)
 *   - `palette`: Default / Paper Warm / Solarized / GitHub
 *
 * Palettes that have a light/dark pair (Default, Solarized, GitHub)
 * honor the current mode. Paper Warm is a warm-beige palette that
 * exists in light only — selecting it produces `data-theme="paper"`
 * regardless of mode.
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
    const resolvedMode = this.resolveMode();
    switch (this.palette) {
      case 'default':
        return resolvedMode === 'dark' ? 'dark' : null;
      case 'paper':
        // Paper Warm is light-only; mode is ignored.
        return 'paper';
      case 'solarized':
        return resolvedMode === 'dark' ? 'solarized-dark' : 'solarized-light';
      case 'github':
        return resolvedMode === 'dark' ? 'github-dark' : 'github-light';
    }
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
