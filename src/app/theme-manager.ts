import {
  loadPalettePreference,
  loadThemePreference,
  type PaletteName,
  savePalettePreference,
  saveThemePreference,
  type ThemePreference,
} from '../preferences';

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** The two halves of the mode axis; `auto` resolves to one of them. */
export type ResolvedMode = 'light' | 'dark';

/**
 * Each palette and the `data-theme` value it is drawn with in the modes it
 * has, `null` meaning the bare `:root` block. **A mode a palette does not have
 * is absent from its entry** rather than written as `null`, because `null` is
 * already a value: it is what Default is drawn with in Light. So Paper Warm
 * has a light entry and no dark one (#391), and OLED Black a dark entry and no
 * light one (#398).
 *
 * One table, so the value set on the page and the answer the Appearance menu
 * is given come from the same place and cannot disagree.
 */
const PALETTE_THEMES: Readonly<
  Record<PaletteName, Readonly<Partial<Record<ResolvedMode, string | null>>>>
> = {
  default: { light: null, dark: 'dark' },
  paper: { light: 'paper' },
  solarized: { light: 'solarized-light', dark: 'solarized-dark' },
  oled: { dark: 'oled' },
};

/** Whether the palette is drawn in that mode at all. */
export function paletteHasMode(palette: PaletteName, mode: ResolvedMode): boolean {
  return Object.hasOwn(PALETTE_THEMES[palette], mode);
}

/**
 * The mode this palette does not have, or `null` where it has both. It is what
 * the Appearance menu greys and what its line says, so the menu names no
 * palette of its own (#391, #398).
 */
export function missingMode(palette: PaletteName): ResolvedMode | null {
  if (!paletteHasMode(palette, 'dark')) return 'dark';
  if (!paletteHasMode(palette, 'light')) return 'light';
  return null;
}

/**
 * Applies the active theme to `<html>` via the `data-theme` attribute.
 * The attribute value composes two independent axes:
 *   - `mode`: Light / Dark / Auto (mirrors OS preference in Auto)
 *   - `palette`: Default / Paper Warm / Solarized / OLED Black
 *
 * Which modes a palette has is answered here, from `PALETTE_THEMES`, and
 * nowhere else (#391, #398): Default and Solarized honor the mode, Paper Warm
 * exists in light only and OLED Black in dark only, so each produces its one
 * value whatever the mode. The stored mode is never changed by a palette: it
 * waits under a one-mode palette, and the palette left for one with both finds
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
   * stored mode, except under a palette that has only one, where the page is
   * in that one whatever was chosen (#391, #398). The stored mode is left as
   * it is.
   */
  getEffectiveMode(): ThemePreference {
    const missing = missingMode(this.palette);
    if (missing === null) return this.mode;
    return missing === 'dark' ? 'light' : 'dark';
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
    const wanted = this.resolveMode();
    const drawn = paletteHasMode(this.palette, wanted) ? wanted : this.otherMode(wanted);
    return themes[drawn] ?? null;
  }

  /** The mode a palette is drawn in when it does not have the one asked for. */
  private otherMode(mode: ResolvedMode): ResolvedMode {
    return mode === 'dark' ? 'light' : 'dark';
  }

  private resolveMode(): ResolvedMode {
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
