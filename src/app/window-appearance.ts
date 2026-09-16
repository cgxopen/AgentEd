/**
 * What the palette says the window frame should look like, and the wiring that
 * keeps the frame following it (#326).
 *
 * **The colour is read from the live token, never written down here.** The
 * stylesheet defines `--surface` seven times, and the value this hands the
 * platform is whatever that resolves to in the palette now on — read back off
 * the root element after the theme has been applied. A table of seven colours
 * in this file would be the #319 defect in a new place: a colour restated
 * beside the stylesheet and free to drift from it.
 *
 * **Why `--surface`**: `#menubar` is painted with it, and the window frame sits
 * directly above the header, so the two read as one surface. `--bg`, the page
 * itself, is the alternative and is one token away.
 *
 * **Why the frame needs to know whether that colour is dark**: what the system
 * draws on the frame — the window title, the caption buttons — is not ours, and
 * every palette has exactly one readable choice for it. Measured from the
 * tokens: against `--surface`, white text is 1.05 to 1.24 in the four light
 * palettes and 13.00 to 17.30 in the three dark ones, and black is the other
 * way round. So the colour alone is not the message; the colour and which of
 * the two it needs are.
 */
import type { WindowAppearance } from '../platform';

/** The token the frame takes its colour from. */
export const FRAME_COLOUR_TOKEN = '--surface';

/** `#rgb`, `#rrggbb`, `rgb(r g b)` and `rgba(r, g, b, a)`, as the three channels. */
function channels(colour: string): [number, number, number] | null {
  const value = colour.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const parts = /^rgba?\(([^)]*)\)$/
    .exec(value)?.[1]
    .split(/[\s,/]+/)
    .filter((part) => part !== '')
    .map(Number);
  if (!parts || parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2]];
}

/** Relative luminance, as WCAG 2 defines it. */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * The appearance a colour describes, or `null` for a value this cannot read —
 * in which case the caller asks for nothing and the frame stays as it is.
 *
 * **`dark` is decided by contrast rather than by a threshold on luminance**:
 * the colour is dark when white stands out on it more than black does, which is
 * the question the frame's own text asks. The two agree at a luminance of about
 * 0.179, and stating it this way is what lets the seven palettes be asserted
 * against the same arithmetic the #319 rows use.
 */
export function appearanceFor(colour: string): WindowAppearance | null {
  const rgb = channels(colour);
  if (!rgb) return null;
  const relative = luminance(rgb);
  const onWhite = 1.05 / (relative + 0.05);
  const onBlack = (relative + 0.05) / 0.05;
  const hex = rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('');
  return { caption: `#${hex}`, dark: onWhite > onBlack };
}

/** The appearance the palette now on describes, read off the root element. */
export function readWindowAppearance(
  root: HTMLElement = document.documentElement,
): WindowAppearance | null {
  return appearanceFor(getComputedStyle(root).getPropertyValue(FRAME_COLOUR_TOKEN));
}

/** What this wiring needs of the theme manager: a way to hear that it changed. */
export interface PaletteChanges {
  onModeChange(listener: () => void): void;
  onPaletteChange(listener: () => void): void;
}

/**
 * Keep the window frame following the palette, and give it the colour once at
 * boot so a window that opens in Solarized Dark does not start in the default.
 *
 * **Three signals, because two are not enough.** Mode and Palette are the two
 * the menu moves. The third is the system's own light-or-dark preference:
 * `ThemeManager` in Auto re-applies the theme when that changes but tells no
 * listener it did — measured in `theme-manager.ts`, where `onSystemChange`
 * calls `apply()` and nothing else — so a window whose palette followed the
 * system at dusk would keep the colour it had at noon.
 *
 * **Every signal re-reads the token rather than carrying a value**, so a signal
 * that changed nothing sends the colour that is already there, and none of them
 * has to know which of the seven the pair resolved to.
 */
export function followPaletteWithTheWindow(
  theme: PaletteChanges,
  apply: (appearance: WindowAppearance) => void,
): void {
  const send = () => {
    const appearance = readWindowAppearance();
    if (appearance) apply(appearance);
  };
  theme.onModeChange(send);
  theme.onPaletteChange(send);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', send);
  send();
}
