/**
 * Issue #326 — the window frame takes the palette's own surface colour.
 *
 * **What no harness can see, said first.** The title bar is drawn by the
 * operating system outside the page: headless Chromium has none, WebView2 draws
 * it beyond the webview, and nothing here can read its colour. So what the bar
 * *looks* like is verified by the owner on Windows or it is not verified.
 *
 * **What is asserted here is the two halves that reach it.** The colour, per
 * palette, resolved out of the shipped stylesheet rather than restated — the
 * #319 shape, where a table of seven colours in a test would drift from the
 * sheet it claims to describe. And the call: that a palette switch reaches the
 * platform, driven through a fake that records what it was handed.
 */
import { describe, expect, it, vi } from 'vitest';
import stylesCss from '../styles.css?raw';
import { stylesheetRules } from '../test-support/stylesheet-rules';
import { contrast, paletteTokens, resolveColour } from '../test-support/theme-colours';
import {
  appearanceFor,
  FRAME_COLOUR_TOKEN,
  followPaletteWithTheWindow,
  readWindowAppearance,
} from './window-appearance';

const palettes = paletteTokens(stylesheetRules(stylesCss));
const paletteNames = [...palettes.keys()];

/** A theme manager as far as this wiring is concerned: two lists of listeners. */
function fakeTheme() {
  const modeListeners: Array<() => void> = [];
  const paletteListeners: Array<() => void> = [];
  return {
    onModeChange: (listener: () => void) => void modeListeners.push(listener),
    onPaletteChange: (listener: () => void) => void paletteListeners.push(listener),
    switchMode: () => {
      for (const listener of modeListeners) listener();
    },
    switchPalette: () => {
      for (const listener of paletteListeners) listener();
    },
  };
}

/** The palette on the document, as the theme manager leaves it. */
function wearPalette(name: string): void {
  const surface = palettes.get(name)?.get(FRAME_COLOUR_TOKEN);
  if (surface === undefined) throw new Error(`no ${FRAME_COLOUR_TOKEN} in ${name}`);
  document.documentElement.style.setProperty(FRAME_COLOUR_TOKEN, surface);
}

describe('the colour the frame is asked for, per palette (#326)', () => {
  it('reads the seven palettes out of the stylesheet, not out of this file', () => {
    expect(paletteNames).toHaveLength(7);
  });

  it('takes the token the header bar is painted with, so the frame continues it', () => {
    // Without this the token is a constant both the code and these rows read,
    // and pointing it at another one would move the frame with every row still
    // green. The stylesheet is what decides instead: whatever `#menubar` is
    // painted with is what the frame asks for.
    const menubar = stylesheetRules(stylesCss).find(
      (rule) => rule.selector === '#menubar' && rule.declarations.has('background'),
    );

    expect(menubar?.declarations.get('background')).toBe(`var(${FRAME_COLOUR_TOKEN})`);
  });

  it.each(paletteNames)('%s: hands over that palette own surface colour', (name) => {
    const surface = palettes.get(name)?.get(FRAME_COLOUR_TOKEN) as string;
    const appearance = appearanceFor(surface);

    expect(appearance?.caption).toBe(surface.trim().toLowerCase());
  });

  it.each(paletteNames)('%s: says dark when white is the readable caption text', (name) => {
    const tokens = palettes.get(name) as Map<string, string>;
    const surface = resolveColour(`var(${FRAME_COLOUR_TOKEN})`, tokens);
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };

    // The same arithmetic the #319 rows use, against the same tokens: the
    // frame is dark exactly when what the system writes on it must be light.
    const appearance = appearanceFor(tokens.get(FRAME_COLOUR_TOKEN) as string);
    expect(appearance?.dark).toBe(contrast(white, surface) > contrast(black, surface));

    // And the readable one clears AA, which is what makes the flag worth
    // sending: 13.00 at worst on the dark palettes, 16.98 on the light ones.
    const readable = appearance?.dark ? contrast(white, surface) : contrast(black, surface);
    expect(readable).toBeGreaterThanOrEqual(4.5);
  });

  it('refuses a value it cannot read rather than guessing one', () => {
    for (const value of ['', 'surface', '#12345', 'hsl(0 0% 50%)']) {
      expect(appearanceFor(value)).toBeNull();
    }
  });

  it('reads rgb as well as hex, since a computed token can arrive either way', () => {
    expect(appearanceFor('rgb(7, 54, 66)')).toEqual({ caption: '#073642', dark: true });
    expect(appearanceFor('#FFF')).toEqual({ caption: '#ffffff', dark: false });
  });

  it('reads the token off the document, so the palette on screen is what is sent', () => {
    wearPalette('solarized-dark');
    expect(readWindowAppearance()).toEqual({ caption: '#073642', dark: true });

    wearPalette('claude');
    expect(readWindowAppearance()).toEqual({ caption: '#efe6d8', dark: false });
  });
});

describe('the frame follows the palette, whatever moved it (#326)', () => {
  it('asks once at boot, so a window that opens in a dark palette is not left light', () => {
    wearPalette('dark');
    const apply = vi.fn();

    followPaletteWithTheWindow(fakeTheme(), apply);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith({ caption: '#242424', dark: true });
  });

  it('asks again on a palette switch, with the colour the new palette resolved to', () => {
    wearPalette('light');
    const apply = vi.fn();
    const theme = fakeTheme();
    followPaletteWithTheWindow(theme, apply);

    wearPalette('github-dark');
    theme.switchPalette();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith({ caption: '#161b22', dark: true });
  });

  it('asks again on a mode switch', () => {
    wearPalette('github-light');
    const apply = vi.fn();
    const theme = fakeTheme();
    followPaletteWithTheWindow(theme, apply);

    wearPalette('github-dark');
    theme.switchMode();

    expect(apply).toHaveBeenLastCalledWith({ caption: '#161b22', dark: true });
  });

  it('asks again when the system light-or-dark preference moves under Auto', () => {
    // The theme manager re-applies the theme there and notifies no listener —
    // read in `theme-manager.ts`, where `onSystemChange` calls `apply()` alone.
    // So this wiring listens to the query itself, and the query is stood in for
    // here: happy-dom answers a fresh object to every `matchMedia` call, so an
    // event dispatched on one would never reach a listener added to another.
    const systemListeners: Array<() => void> = [];
    const query = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_: string, listener: () => void) => void systemListeners.push(listener),
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    wearPalette('light');
    const apply = vi.fn();
    followPaletteWithTheWindow(fakeTheme(), apply);
    expect(systemListeners, 'the wiring subscribed to the system preference').toHaveLength(1);

    wearPalette('dark');
    for (const listener of systemListeners) listener();

    expect(apply).toHaveBeenLastCalledWith({ caption: '#242424', dark: true });
    query.mockRestore();
  });

  it('asks for nothing when the token says nothing it can read', () => {
    document.documentElement.style.setProperty(FRAME_COLOUR_TOKEN, 'inherit');
    const apply = vi.fn();

    followPaletteWithTheWindow(fakeTheme(), apply);

    expect(apply).not.toHaveBeenCalled();
  });
});
