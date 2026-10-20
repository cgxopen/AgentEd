import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecentFiles,
  EMOJI_FREQUENT_BOUND,
  forgetRecentFile,
  loadFrequentEmoji,
  loadLastOpenedFolder,
  loadPalettePreference,
  loadRecentFiles,
  loadThemePreference,
  purgeLegacyPreferences,
  RECENT_FILES_BOUND,
  recordEmojiUse,
  recordRecentFile,
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
    savePalettePreference('paper');
    expect(loadPalettePreference()).toBe('paper');
  });

  // #635: nothing stored is told apart from a choice, so the theme manager can
  // draw Paper Warm or Default by the mode; nothing else reads otherwise.
  it('returns null when no palette is stored', () => {
    expect(loadPalettePreference()).toBeNull();
  });

  it('still reads a value it does not know as "default", as before #635', () => {
    localStorage.setItem('agented:palette', 'github');
    expect(loadPalettePreference()).toBe('default');
  });

  it('still reads "default" when storage cannot be read, as before #635', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(loadPalettePreference()).toBe('default');
    } finally {
      vi.unstubAllGlobals();
    }
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
    savePalettePreference('paper');
    saveLastOpenedFolder('/home/user/projects');
    localStorage.setItem('agented:default-mode', 'skill');

    purgeLegacyPreferences();

    expect(loadThemePreference()).toBe('dark');
    expect(loadPalettePreference()).toBe('paper');
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

describe('recent files (#381)', () => {
  const file = (n: number) => `C:\\notes\\file-${n}.md`;

  it('holds what was opened, newest first', () => {
    recordRecentFile(file(1));
    recordRecentFile(file(2));
    expect(loadRecentFiles()).toEqual([file(2), file(1)]);
  });

  it('holds ten, and an eleventh open takes the oldest off', () => {
    for (let n = 1; n <= 11; n += 1) recordRecentFile(file(n));
    const list = loadRecentFiles();
    expect(RECENT_FILES_BOUND).toBe(10);
    expect(list).toHaveLength(10);
    expect(list[0]).toBe(file(11));
    expect(list).not.toContain(file(1));
  });

  it('moves a file opened again to the top rather than holding it twice', () => {
    for (let n = 1; n <= 3; n += 1) recordRecentFile(file(n));
    recordRecentFile(file(1));
    expect(loadRecentFiles()).toEqual([file(1), file(3), file(2)]);
  });

  it('holds one Windows file once whatever the case it was spelled in, under the newest spelling', () => {
    recordRecentFile('C:\\Notes\\a.md');
    recordRecentFile('c:/notes/A.md');
    expect(loadRecentFiles()).toEqual(['c:/notes/A.md']);
  });

  it('empties the store on Clear, so a restart finds nothing', () => {
    recordRecentFile(file(1));
    clearRecentFiles();
    expect(localStorage.getItem('agented:recent-files')).toBeNull();
    expect(loadRecentFiles()).toEqual([]);
  });

  it('takes one file off and leaves the rest in order', () => {
    for (let n = 1; n <= 3; n += 1) recordRecentFile(file(n));
    forgetRecentFile(file(2));
    expect(loadRecentFiles()).toEqual([file(3), file(1)]);
  });

  it('reads a value that is not a list of paths as an empty list', () => {
    localStorage.setItem('agented:recent-files', '{"not":"a list"}');
    expect(loadRecentFiles()).toEqual([]);
    localStorage.setItem('agented:recent-files', 'not json');
    expect(loadRecentFiles()).toEqual([]);
  });
});
