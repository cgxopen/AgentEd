/**
 * #384 — a closed search panel means the search is over: every route that
 * closes it clears the highlights, the find field keeps its text, and F3,
 * Shift+F3 and the Edit menu Find Next and Find Previous open it again with
 * that text and step from the match it was on.
 *
 * Both halves are observable here: the highlights are decorations the editor
 * draws as elements, and the panel open or closed is an attribute. The
 * manager is the real one, over a real editor and the shipped panel markup.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { wireSearchButton } from './header-wiring';
import { createSearchManager, type SearchManager } from './search-manager';

function shippedFragment(from: string, to: string): string {
  const open = shippedPage.indexOf(from);
  const close = shippedPage.indexOf(to, open);
  if (open < 0 || close < 0) throw new Error(`index.html no longer has ${from} … ${to}`);
  return shippedPage.slice(open, close + to.length);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped page has no #${id}`);
  return found;
}

// One manager for the file: its keyboard listener has no teardown.
let instance: EditorInstance;
let manager: SearchManager;

beforeAll(() => {
  document.body.innerHTML = [
    shippedFragment('<header id="menubar">', '</header>'),
    shippedFragment('<div id="search-panel"', '<details id="frontmatter-panel"').replace(
      /<details id="frontmatter-panel"$/,
      '',
    ),
    '<div id="editor-host"></div>',
  ].join('');
  instance = createEditor(element('editor-host'));
  instance.setMarkdown('alpha one alpha two alpha three');
  manager = createSearchManager({ editor: instance.editor, panelRoot: element('search-panel') });
  manager.installKeyboardListeners();
  wireSearchButton(manager);
});

afterAll(() => {
  instance.destroy();
  document.body.innerHTML = '';
});

beforeEach(() => {
  if (manager.isOpen()) manager.close();
  findInput().value = '';
});

const findInput = () => element('search-input') as HTMLInputElement;
const replaceInput = () => element('search-replace-input') as HTMLInputElement;
const count = () => element('search-count').textContent;
const highlights = () => document.querySelectorAll('#editor-host .search-result').length;
const key = (target: EventTarget, name: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, ...init }));

/** Search `alpha` with the panel open, and stand on match `at` of three. */
function searchAlpha(at = 1): void {
  findInput().value = 'alpha';
  manager.openFind();
  for (let n = 1; n < at; n += 1) manager.findNext();
  expect(count()).toBe(`${at} of 3`);
  expect(highlights()).toBe(3);
}

describe('every route that closes the panel clears the highlights (#384)', () => {
  it.each([
    ['the close cross', () => element('search-close').click()],
    ['Escape in the find field', () => key(findInput(), 'Escape')],
    [
      'Escape in the replace field',
      () => {
        manager.openReplace();
        key(replaceInput(), 'Escape');
      },
    ],
    ['the header button', () => element('indicator-search').click()],
  ] as const)('%s', (_route, close) => {
    searchAlpha();
    close();

    expect(manager.isOpen()).toBe(false);
    expect(highlights()).toBe(0);
  });
});

describe('the fields keep their text (#384)', () => {
  it('opens again with the text of the find field, and searches with it', () => {
    searchAlpha();
    manager.close();
    expect(findInput().value).toBe('alpha');

    manager.openFind();
    expect(findInput().value).toBe('alpha');
    expect(highlights()).toBe(3);
  });

  it('keeps the text of the replace field', () => {
    searchAlpha();
    manager.openReplace();
    replaceInput().value = 'omega';
    manager.close();

    expect(replaceInput().value).toBe('omega');
  });
});

describe('F3 with the panel closed opens it again and steps from where it was (#384)', () => {
  it('F3 opens the panel and moves to the next match', () => {
    searchAlpha(2);
    manager.close();

    key(document.body, 'F3');

    expect(manager.isOpen()).toBe(true);
    expect(highlights()).toBe(3);
    expect(count()).toBe('3 of 3');
  });

  it('Shift+F3 opens the panel and moves to the previous match', () => {
    searchAlpha(2);
    manager.close();

    key(document.body, 'F3', { shiftKey: true });

    expect(manager.isOpen()).toBe(true);
    expect(count()).toBe('1 of 3');
  });

  it('Find Next in the Edit menu, which runs the same command, does the same', () => {
    // The menu entry calls `findNext` on this manager: `main.ts` hands it
    // over, and `menu.test.ts` holds the entry to that handler.
    searchAlpha(2);
    manager.close();

    manager.findNext();

    expect(manager.isOpen()).toBe(true);
    expect(count()).toBe('3 of 3');
  });

  it('does nothing with the find field empty', () => {
    searchAlpha();
    manager.close();
    findInput().value = '';

    key(document.body, 'F3');
    manager.findNext();

    expect(manager.isOpen()).toBe(false);
    expect(highlights()).toBe(0);
  });
});
