import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadLastOpenedFolder,
  loadPalettePreference,
  loadThemePreference,
  purgeLegacyPreferences,
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
    saveLastOpenedFolder('/home/cata/projects');
    expect(loadLastOpenedFolder()).toBe('/home/cata/projects');
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
    saveLastOpenedFolder('/home/cata/projects');
    localStorage.setItem('agented:default-mode', 'skill');

    purgeLegacyPreferences();

    expect(loadThemePreference()).toBe('dark');
    expect(loadPalettePreference()).toBe('claude');
    expect(loadLastOpenedFolder()).toBe('/home/cata/projects');
    expect(localStorage.getItem('agented:default-mode')).toBeNull();
  });

  it('is a no-op on a clean store', () => {
    expect(() => purgeLegacyPreferences()).not.toThrow();
  });
});
