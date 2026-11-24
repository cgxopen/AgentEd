/**
 * #766 - the words and the drawing of the check of the folder: the door, the
 * line of a check running with its turning mark, and the rule of that mark in
 * the shipped stylesheet. happy-dom draws nothing, so the rule is read out of
 * the sheet and run against the element the module drew; that the mark turns
 * on screen is measured on the pull request and seen in the manual pass.
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_FILE_BYTES, utf8Length } from '../app/folder-link-check';
import { renameDocument } from '../app/rename-flow';
import { AppState } from '../app/state';
import type { PlatformIO } from '../platform/types';
import stylesheet from '../styles.css?raw';
import { reaches, stylesheetRules } from '../test-support/stylesheet-rules';
import {
  drawDoor,
  drawRunning,
  FILE_TOO_LARGE_LINE,
  FOLDER_CHECK_DOOR,
  FOLDER_CHECK_RING_CLASS,
} from './links-folder-report';

describe('the words of the door and of the running line (owner decision of 2026-11-24)', () => {
  it('the door reads Check links in this folder', () => {
    expect(drawDoor(() => {}).textContent).toBe('Check links in this folder');
    expect(FOLDER_CHECK_DOOR).toBe('Check links in this folder');
  });

  it('the running line reads Checking… 34 of 212 · Stop, the ring before the words and hidden', () => {
    const line = drawRunning(34, 212, () => {});
    expect(line.textContent).toBe('Checking… 34 of 212·Stop');
    const first = line.firstElementChild as HTMLElement;
    expect(first.classList.contains(FOLDER_CHECK_RING_CLASS)).toBe(true);
    expect(first.getAttribute('aria-hidden')).toBe('true');
  });

  it('the sentence of the size bound names the bound', () => {
    expect(FILE_TOO_LARGE_LINE).toBe(
      'This file is larger than 512 KB, so its links are not checked.',
    );
    expect(MAX_FILE_BYTES).toBe(512_000);
  });
});

describe('the turning mark is the ring of #354, small, with no new animation', () => {
  const rules = stylesheetRules(stylesheet);
  const ring = drawRunning(1, 2, () => {}).firstElementChild as HTMLElement;
  const reading = document.createElement('div');
  reading.className = 'sidebar-reading';
  const animationOf = (el: Element, reduced: boolean) =>
    rules
      .filter((r) => reaches(r.selector, el) && r.declarations.has('animation'))
      .filter((r) =>
        reduced
          ? r.conditions.some((c) => c.includes('prefers-reduced-motion'))
          : r.conditions.length === 0,
      )
      .map((r) => r.declarations.get('animation') ?? '');

  it('it turns on the keyframes of the reading ring, at its speed, from the first frame', () => {
    expect(animationOf(ring, false)).toEqual(['sidebar-reading-turn 0.8s linear infinite']);
    expect(animationOf(reading, false).join(' ')).toContain('sidebar-reading-turn 0.8s linear');
  });

  it('with reduced motion it does not turn, as the reading ring does not', () => {
    expect(animationOf(ring, true)).toEqual(['none']);
    expect(animationOf(reading, true).join(' ')).not.toContain('sidebar-reading-turn');
  });

  it('the stylesheet declares no keyframes of its own for it', () => {
    expect(stylesheet).not.toMatch(/@keyframes\s+links-folder/);
  });
});

describe('the bytes of a file, for the size bound', () => {
  it('counts UTF-8 as an encoder does', () => {
    for (const text of ['', 'abc', 'ă î ș ț', '漢字', 'emoji \u{1F4C4} here', 'x'.repeat(1000)]) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
    }
  });
});

describe('a rename tells the report of the folder (#766)', () => {
  it('the old path and the new are handed on, once the rename is done', async () => {
    const state = new AppState();
    state.filePath = '/notes/docs/a.md';
    const io = {
      entryPresence: async () => 'present',
      renameDocument: async () => '/notes/docs/alpha.md',
    } as unknown as PlatformIO;
    const renamed = vi.fn();
    await renameDocument({
      state,
      io: async () => io,
      askName: async () => 'alpha',
      readyToRename: async () => true,
      setFilename: () => {},
      redrawPanel: async () => {},
      replaceRecent: () => {},
      tell: async () => {},
      renamed,
    });
    expect(renamed).toHaveBeenCalledWith('/notes/docs/a.md', '/notes/docs/alpha.md');
  });
});
