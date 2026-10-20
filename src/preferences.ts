import { samePath } from './platform/paths';

// ── Theme preference ──

export type ThemePreference = 'light' | 'dark' | 'auto';

const THEME_PREF_KEY = 'agented:theme';

export function loadThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_PREF_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch (e) {
    console.warn('[preferences] read theme failed, using auto:', e);
  }
  return 'auto';
}

export function saveThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_PREF_KEY, pref);
  } catch (e) {
    console.warn('[preferences] save theme failed:', e);
  }
}

export type PaletteName = 'default' | 'paper' | 'solarized' | 'oled';

const PALETTE_PREF_KEY = 'agented:palette';
const PALETTE_VALUES: readonly PaletteName[] = ['default', 'paper', 'solarized', 'oled'];

/**
 * The name Paper Warm was stored under until #379, and the one place the old
 * name is still spelled. Any value this module does not know reads as Default,
 * so without this a person who had chosen the palette would open the renamed
 * build on Default. It is read as `paper` and written back once, here, where
 * `ThemeManager` reads the palette before it first applies a theme.
 */
const PALETTE_BEFORE_379 = 'claude';

/**
 * The palette a person chose, or `null` when **nothing is stored** (#635): then
 * the theme manager draws Paper Warm in a light mode and Default in a dark one
 * until a palette is chosen. Only an absent key reads as `null`. A value this
 * module does not know, and a storage that cannot be read, still read as
 * Default, as they did before, so no stored value reads otherwise than it did.
 */
export function loadPalettePreference(): PaletteName | null {
  try {
    const stored = localStorage.getItem(PALETTE_PREF_KEY);
    if (stored === null) return null;
    if (stored === PALETTE_BEFORE_379) {
      savePalettePreference('paper');
      return 'paper';
    }
    if (stored && (PALETTE_VALUES as readonly string[]).includes(stored)) {
      return stored as PaletteName;
    }
  } catch (e) {
    console.warn('[preferences] read palette failed:', e);
  }
  return 'default';
}

export function savePalettePreference(p: PaletteName): void {
  try {
    localStorage.setItem(PALETTE_PREF_KEY, p);
  } catch (e) {
    console.warn('[preferences] save palette failed:', e);
  }
}

// ── Last opened folder ──
//
// Persisted across sessions — used as the initial directory for the
// next File → Open dialog. Stores the parent of the most recently
// opened file. The files themselves are remembered by the recent files
// list below, since #381, and nowhere else.

const LAST_FOLDER_KEY = 'agented:last-opened-folder';

export function loadLastOpenedFolder(): string | null {
  try {
    const stored = localStorage.getItem(LAST_FOLDER_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch (e) {
    console.warn('[preferences] read last-opened-folder failed:', e);
    return null;
  }
}

export function saveLastOpenedFolder(folder: string): void {
  if (!folder || folder.length === 0) return;
  try {
    localStorage.setItem(LAST_FOLDER_KEY, folder);
  } catch (e) {
    console.warn('[preferences] save last-opened-folder failed:', e);
  }
}

// ── Recent files (#381) ──
//
// The ten documents most recently opened or saved with Save As, newest
// first, each held once. **This is the first thing AgentEd stores about
// which documents a person works on**, reversing what this file said until
// #381 (owner decision of 2026-09-19, REQUIREMENTS R-C3): it stays on this
// machine, is sent nowhere, and Clear recent files removes it.
//
// Read from the store every time it is asked for, never held: every window
// is a process of its own writing the same key, so a list read once at
// launch would miss what another window opened since.

const RECENT_FILES_KEY = 'agented:recent-files';

/** How many the list holds. The oldest leaves when an eleventh arrives. */
export const RECENT_FILES_BOUND = 10;

/** The list, newest first. A value that is not a list of paths reads as empty. */
export function loadRecentFiles(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .slice(0, RECENT_FILES_BOUND);
  } catch (e) {
    console.warn('[preferences] read recent files failed:', e);
    return [];
  }
}

function saveRecentFiles(paths: readonly string[]): void {
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(paths));
  } catch (e) {
    console.warn('[preferences] save recent files failed:', e);
  }
}

/**
 * Put `path` at the top. A file already on the list moves there rather than
 * appearing twice, under the spelling it arrived with now; which spellings
 * are one file is `samePath`.
 */
export function recordRecentFile(path: string): void {
  const others = loadRecentFiles().filter((entry) => !samePath(entry, path));
  saveRecentFiles([path, ...others].slice(0, RECENT_FILES_BOUND));
}

/** Take `path` off the list, for a file that is no longer there. */
export function forgetRecentFile(path: string): void {
  saveRecentFiles(loadRecentFiles().filter((entry) => !samePath(entry, path)));
}

/** Empty the list, in the store and not only on screen. */
export function clearRecentFiles(): void {
  try {
    localStorage.removeItem(RECENT_FILES_KEY);
  } catch (e) {
    console.warn('[preferences] clear recent files failed:', e);
  }
}

// ── Frequently used emoji (#296) ──
//
// How many times each emoji was chosen from the palette, so its first row can
// show the ones used most. A count per emoji and nothing else: no document,
// no path and no time is stored. Every window reads and writes the same
// list, as it does the theme; that was measured with two pages of one origin
// in Chromium on the #296 step zero and not in Tauri.

const EMOJI_FREQUENT_KEY = 'agented:emoji-frequent';

/** The most emoji remembered, by owner decision on #296. */
export const EMOJI_FREQUENT_BOUND = 50;

/**
 * The stored counts, most used first. Among equal counts the one chosen for
 * the first time earlier comes first, which is the order the object keeps.
 * Anything stored that is not a positive count is left out.
 */
export function loadFrequentEmoji(): Array<readonly [char: string, count: number]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(EMOJI_FREQUENT_KEY) ?? '{}');
  } catch (e) {
    console.warn('[preferences] read frequent emoji failed, using none:', e);
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .filter((entry): entry is [string, number] => {
      const count = entry[1];
      return typeof count === 'number' && Number.isInteger(count) && count > 0;
    })
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Counts one more use of `char`. Past the bound the least used emoji is
 * forgotten, **never the one just chosen**: otherwise, once fifty emoji had
 * each been used once, a new one would be dropped the moment it was counted
 * and could never reach the row.
 */
export function recordEmojiUse(char: string): void {
  const counts = loadFrequentEmoji();
  const index = counts.findIndex(([stored]) => stored === char);
  if (index >= 0) counts[index] = [char, counts[index][1] + 1];
  else counts.push([char, 1]);
  counts.sort((a, b) => b[1] - a[1]);
  while (counts.length > EMOJI_FREQUENT_BOUND) {
    const last = counts.findLastIndex(([stored]) => stored !== char);
    counts.splice(last, 1);
  }
  try {
    localStorage.setItem(EMOJI_FREQUENT_KEY, JSON.stringify(Object.fromEntries(counts)));
  } catch (e) {
    console.warn('[preferences] save frequent emoji failed:', e);
  }
}

// ── Legacy keys cleanup ──
//
// Earlier versions persisted document modes, per-mode frontmatter
// requirements, a workspace preset, and a one-shot tip about structured
// save layouts. None of those concepts exist any more (ADR-001), so the
// keys are swept from localStorage rather than left behind on machines
// that ran an older build. This runs once per launch; after the first
// one the keys are gone and it stays silent. Surviving preferences:
// theme + palette + last opened folder + frequently used emoji + recent
// files.

const LEGACY_KEYS = [
  'agented:default-mode',
  'agented:default-format',
  'agented:frontmatter-required',
  'agented:workspace',
  'agented:save-as-layout-tip-shown',
];

export function purgeLegacyPreferences(): void {
  for (const key of LEGACY_KEYS) {
    try {
      if (localStorage.getItem(key) !== null) {
        console.info(`[preferences] removing legacy key: ${key}`);
        localStorage.removeItem(key);
      }
    } catch (e) {
      console.warn(`[preferences] purge ${key} failed:`, e);
    }
  }
}
