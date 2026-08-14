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

export type PaletteName = 'default' | 'claude' | 'solarized' | 'github';

const PALETTE_PREF_KEY = 'agented:palette';
const PALETTE_VALUES: readonly PaletteName[] = ['default', 'claude', 'solarized', 'github'];

export function loadPalettePreference(): PaletteName {
  try {
    const stored = localStorage.getItem(PALETTE_PREF_KEY);
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
// opened file, never the file path itself: AgentEd does not remember
// which document you had open.

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

// ── Legacy keys cleanup ──
//
// Earlier versions persisted document modes, per-mode frontmatter
// requirements, a workspace preset, and a one-shot tip about structured
// save layouts. None of those concepts exist any more (ADR-001), so the
// keys are swept from localStorage rather than left behind on machines
// that ran an older build. This runs once per launch; after the first
// one the keys are gone and it stays silent. Surviving preferences:
// theme + palette + last opened folder.

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
