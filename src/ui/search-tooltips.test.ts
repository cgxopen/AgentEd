/**
 * Issue #352 — the search tooltips name only keys that do something.
 *
 * The three option toggles named Alt+C, Alt+W and Alt+R, which nothing binds:
 * measured by pressing them in Chromium, in the document and in the search
 * field, and no toggle moved. They now name no key (owner decision of
 * 2026-09-18). The two navigation buttons named Enter alone, which works only
 * while the caret is in the search field; they now name F3 as well, which
 * works anywhere once a search is made (owner decision of the same day, after
 * F3 and Shift+F3 were measured walking the matches on Windows and Chromium).
 * Find Previous keeps Shift+F3 in the Edit menu, for the same measurement: as
 * the text beside the entry until #390, and as its tooltip since.
 *
 * **The text is observable here**, so it is read from the shipped `index.html`
 * rather than from a copy. What a key does is not asserted in this file: F3
 * and Shift+F3 are driven in `app/search-button.test.ts`, and Enter in
 * `ui/search-panel.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';

/**
 * The shipped page's body, parsed rather than mounted, and without the head and
 * the module script: happy-dom fetches a stylesheet link even in a parsed
 * document (#351).
 */
const shipped = new DOMParser().parseFromString(
  shippedPage.slice(shippedPage.indexOf('<body>'), shippedPage.indexOf('<script')),
  'text/html',
);

function titleOf(id: string): string | null {
  const found = shipped.getElementById(id);
  if (!found) throw new Error(`the shipped page has no #${id}`);
  return found.getAttribute('title');
}

/** The tooltips this issue decides, one row each so a single word put back is a single red row. */
const DECIDED: ReadonlyArray<readonly [string, string]> = [
  ['search-toggle-case', 'Match case'],
  ['search-toggle-word', 'Whole word'],
  // Use regex until #373, when the owner took the word regex out of the interface.
  ['search-toggle-regex', 'Search with patterns'],
  ['search-find-prev', 'Previous (Shift+Enter, Shift+F3)'],
  ['search-find-next', 'Next (Enter, F3)'],
];

describe('the search tooltips name keys that work (#352)', () => {
  it.each(DECIDED)('#%s reads %s', (id, title) => {
    expect(titleOf(id)).toBe(title);
  });

  it('keeps Shift+F3 on Find Previous in the Edit menu, as its tooltip since #390', () => {
    expect(titleOf('menu-find-prev')).toBe('Shift+F3');
  });
});

/**
 * The regression half: every other tooltip in the shipped page, byte for byte.
 * A text this issue did not decide that changes, appears or goes turns this
 * red. The menu shortcuts it also read left the entries with #390 and are the
 * tooltips of their entries now, listed below and pinned entry by entry in
 * `menu-shortcut-tooltips.test.ts`.
 */
describe('every other tooltip is unchanged (#352)', () => {
  it('reads every other title in the page as it was', () => {
    const decided = new Set(DECIDED.map(([id]) => id));
    const others = [...shipped.querySelectorAll('[title]')]
      .filter((element) => !decided.has(element.id))
      .map((element) => [element.id, element.getAttribute('title')]);

    expect(others).toEqual([
      ['filename', 'Untitled'],
      ['token-number', '– tokens'],
      ['indicator-search', 'Find (Ctrl+F)'],
      ['overflow-toggle', 'Hover any indicator for details'],
      ['appearance-menu-trigger', 'Appearance'],
      ['sidebar-toggle', 'Files panel (Ctrl+Shift+E)'],
      ['menu-open', 'Ctrl+O'],
      ['menu-save', 'Ctrl+S'],
      ['menu-find', 'Ctrl+F'],
      ['menu-replace', 'Ctrl+H'],
      ['menu-find-next', 'F3'],
      ['menu-find-prev', 'Shift+F3'],
      ['menu-undo', 'Ctrl+Z'],
      ['menu-redo', 'Ctrl+Y'],
      ['menu-select-all', 'Ctrl+A'],
      ['menu-insert-code-block', 'Ctrl+Shift+K'],
      ['search-close', 'Close (Esc)'],
    ]);
  });
});
