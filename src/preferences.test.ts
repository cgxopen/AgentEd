import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMOJI_FREQUENT_BOUND,
  loadFrequentEmoji,
  loadLastOpenedFolder,
  loadPalettePreference,
  loadThemePreference,
  purgeLegacyPreferences,
  recordEmojiUse,
  saveLastOpenedFolder,
  savePalettePreference,
  saveThemePreference,
} from './preferences';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme + palette persistence', () => {
  it('round-trips theme', () => {
    saveThemePreference('dark');
    expect(loadThemePreference()).toBe('dark');
  });

  it('returns "auto" when no theme is stored', () => {
    expect(loadThemePreference()).toBe('auto');
  });

  it('round-trips palette', () => {
    savePalettePreference('claude');
    expect(loadPalettePreference()).toBe('claude');
  });

  it('returns "default" when no palette is stored', () => {
    expect(loadPalettePreference()).toBe('default');
  });
});

describe('last opened folder', () => {
  it('round-trips a non-empty folder path', () => {
    saveLastOpenedFolder('/home/user/projects');
    expect(loadLastOpenedFolder()).toBe('/home/user/projects');
  });

  it('returns null when no folder is stored', () => {
    expect(loadLastOpenedFolder()).toBeNull();
  });

  it('refuses to save an empty folder path', () => {
    saveLastOpenedFolder('');
    expect(loadLastOpenedFolder()).toBeNull();
  });

  it('returns null when an empty string was somehow stored', () => {
    localStorage.setItem('agented:last-opened-folder', '');
    expect(loadLastOpenedFolder()).toBeNull();
  });
});

describe('purgeLegacyPreferences', () => {
  it('removes the four deprecated keys when present', () => {
    localStorage.setItem('agented:default-mode', 'skill');
    localStorage.setItem('agented:default-format', 'plain-md');
    localStorage.setItem('agented:frontmatter-required', '{}');
    localStorage.setItem('agented:workspace', 'agentic');

    purgeLegacyPreferences();

    expect(localStorage.getItem('agented:default-mode')).toBeNull();
    expect(localStorage.getItem('agented:default-format')).toBeNull();
    expect(localStorage.getItem('agented:frontmatter-required')).toBeNull();
    expect(localStorage.getItem('agented:workspace')).toBeNull();
  });

  it('leaves theme + palette + last-opened-folder intact', () => {
    saveThemePreference('dark');
    savePalettePreference('claude');
    saveLastOpenedFolder('/home/user/projects');
    localStorage.setItem('agented:default-mode', 'skill');

    purgeLegacyPreferences();

    expect(loadThemePreference()).toBe('dark');
    expect(loadPalettePreference()).toBe('claude');
    expect(loadLastOpenedFolder()).toBe('/home/user/projects');
    expect(localStorage.getItem('agented:default-mode')).toBeNull();
  });

  it('is a no-op on a clean store', () => {
    expect(() => purgeLegacyPreferences()).not.toThrow();
  });
});

describe('frequently used emoji (#296)', () => {
  it('counts each use, most used first, and nothing is stored before the first', () => {
    expect(loadFrequentEmoji()).toEqual([]);
    recordEmojiUse('a');
    recordEmojiUse('b');
    recordEmojiUse('b');

    expect(loadFrequentEmoji()).toEqual([
      ['b', 2],
      ['a', 1],
    ]);
  });

  it('keeps the one chosen first ahead among equal counts', () => {
    recordEmojiUse('a');
    recordEmojiUse('b');

    expect(loadFrequentEmoji().map(([char]) => char)).toEqual(['a', 'b']);
  });

  it('remembers at most the bound, and never forgets the one just chosen', () => {
    for (let i = 0; i < EMOJI_FREQUENT_BOUND; i++) recordEmojiUse(`e${i}`);
    recordEmojiUse('new');

    const kept = loadFrequentEmoji().map(([char]) => char);
    expect(kept).toHaveLength(EMOJI_FREQUENT_BOUND);
    expect(kept).toContain('new');
    expect(kept).not.toContain(`e${EMOJI_FREQUENT_BOUND - 1}`);
  });

  it('reads a store it cannot parse, or one holding anything but counts, as none', () => {
    localStorage.setItem('agented:emoji-frequent', '{not json');
    expect(loadFrequentEmoji()).toEqual([]);
    localStorage.setItem('agented:emoji-frequent', JSON.stringify({ a: 'x', b: -1, c: 1.5, d: 2 }));
    expect(loadFrequentEmoji()).toEqual([['d', 2]]);
    localStorage.setItem('agented:emoji-frequent', JSON.stringify(['a']));
    expect(loadFrequentEmoji()).toEqual([]);
  });
});
