import { describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { stylesheetRules } from './stylesheet-rules';
import { contrast, over, paletteTokens, resolveColour } from './theme-colours';

const tokens = new Map([
  ['--ink', '#1a1a1a'],
  ['--alias', 'var(--ink)'],
  ['--veil', 'rgba(255, 255, 255, 0.5)'],
]);

describe('the colour reader these tests stand on', () => {
  it('reads hex in both lengths and rgba with an alpha', () => {
    expect(resolveColour('#fff', tokens)).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(resolveColour('#1a2b3c', tokens)).toEqual({ r: 26, g: 43, b: 60, a: 1 });
    expect(resolveColour('rgba(0, 43, 54, 0.08)', tokens)).toEqual({ r: 0, g: 43, b: 54, a: 0.08 });
  });

  it('follows a var() through another var()', () => {
    expect(resolveColour('var(--alias)', tokens)).toEqual({ r: 26, g: 26, b: 26, a: 1 });
  });

  it('reads the single-colour gradient a stacked shade is drawn with, and refuses a real one', () => {
    expect(resolveColour('linear-gradient(var(--veil), var(--veil))', tokens).a).toBe(0.5);
    expect(() => resolveColour('linear-gradient(#000, #fff)', tokens)).toThrow();
  });

  it('mixes in srgb with the weight on either side, and halves without one', () => {
    const black = '#000000';
    const white = '#ffffff';
    expect(resolveColour(`color-mix(in srgb, ${black} 25%, ${white})`, tokens).r).toBeCloseTo(
      191.25,
    );
    expect(resolveColour(`color-mix(in srgb, ${black}, ${white} 25%)`, tokens).r).toBeCloseTo(
      63.75,
    );
    expect(resolveColour(`color-mix(in srgb, ${black}, ${white})`, tokens).r).toBeCloseTo(127.5);
  });

  it('throws on a form it does not read, rather than answering', () => {
    expect(() => resolveColour('hsl(0 0% 50%)', tokens)).toThrow();
    expect(() => resolveColour('var(--missing)', tokens)).toThrow();
  });

  it('composites and measures contrast the way WCAG 2 does', () => {
    const black = resolveColour('#000000', tokens);
    const white = resolveColour('#ffffff', tokens);
    expect(contrast(black, white)).toBeCloseTo(21);
    expect(over(resolveColour('var(--veil)', tokens), black).r).toBeCloseTo(127.5);
  });

  it('finds the seven palettes the shipped stylesheet defines, each with the base tokens under it', () => {
    const palettes = paletteTokens(stylesheetRules(stylesCss));
    expect([...palettes.keys()].sort()).toEqual(
      [
        'claude',
        'dark',
        'github-dark',
        'github-light',
        'light',
        'solarized-dark',
        'solarized-light',
      ].sort(),
    );
    for (const palette of palettes.values()) {
      expect(palette.get('--text')).toMatch(/^#/);
      expect(palette.get('--surface')).toMatch(/^#/);
    }
  });
});
