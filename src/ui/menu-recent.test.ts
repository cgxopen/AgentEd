/**
 * #381 — Open Recent, and the card it opens beside the menu.
 *
 * Driven the way a person drives it: the shipped header from `index.html`, the
 * real `setupMenu`, the toggle, the File section, the entry. What is not seen
 * here is where the card lands on screen, which happy-dom does not lay out;
 * that is the owner pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { type MenuCallbacks, setupMenu } from './menu';
import { RECENT_MENU_ID, recentLabels } from './menu-recent';

const LIST = [
  'C:\\Users\\vasil\\notes\\README.md',
  'C:\\Users\\vasil\\work\\plan.md',
  'C:\\Users\\vasil\\archive\\README.md',
];

let stored: string[] | null;

function spies(): MenuCallbacks {
  return new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (target, key: string) => {
      target[key] ??= vi.fn();
      return target[key];
    },
  }) as unknown as MenuCallbacks;
}

let handlers: MenuCallbacks;

beforeEach(() => {
  document.body.innerHTML = shippedElement(shippedPage, '<header id="menubar"');
  stored = [...LIST];
  handlers = spies();
  setupMenu(
    handlers,
    () => ({ canUndo: true, canRedo: true }),
    () => ({}),
    () => stored,
  );
});

afterEach(() => {
  document.body.innerHTML = '';
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const trigger = () => byId('menu-open-recent') as HTMLButtonElement;
const card = () => document.getElementById(RECENT_MENU_ID);
const cardEntries = () => [...(card()?.querySelectorAll<HTMLButtonElement>('button') ?? [])];

function openFileSection(): void {
  byId('menu-toggle').click();
  byId('menu-section-file').click();
}

/** Open Recent pressed with the pointer, which leaves focus where it was. */
function openCard(): void {
  openFileSection();
  trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
}

describe('Open Recent in the File section (#381)', () => {
  it('sits below Open and says it opens a list', () => {
    openFileSection();
    expect(byId('menu-open').nextElementSibling).toBe(trigger());
    expect(trigger().getAttribute('aria-haspopup')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(RECENT_MENU_ID);
    expect(trigger().hidden).toBe(false);
  });

  it('is absent where the build keeps no list', () => {
    stored = null;
    openFileSection();
    expect(trigger().hidden).toBe(true);
  });

  it('is greyed with nothing on the list, and opens nothing', () => {
    stored = [];
    openCard();
    expect(trigger().disabled).toBe(true);
    expect(card()).toBeNull();
  });
});

describe('the card lists the files, newest first (#381)', () => {
  it('shows each by its name and the folder that tells it apart, the path on hover', () => {
    openCard();
    const rows = cardEntries().slice(0, -1);
    expect(rows.map((row) => row.querySelector('.menu-recent-name')?.textContent)).toEqual([
      'README.md',
      'plan.md',
      'README.md',
    ]);
    expect(rows.map((row) => row.querySelector('.menu-recent-folder')?.textContent)).toEqual([
      'notes',
      'work',
      'archive',
    ]);
    expect(rows.map((row) => row.title)).toEqual(LIST);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('ends with Clear recent files', () => {
    openCard();
    expect(cardEntries().at(-1)?.textContent).toBe('Clear recent files');
  });

  it.each(
    LIST.map((path, i) => [i, path] as const),
  )('entry %i opens its own file, closes the menu, and runs nothing else', (i, path) => {
    openCard();
    cardEntries()[i].click();

    expect(handlers.onOpenRecentFile).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenRecentFile).toHaveBeenCalledWith(path);
    expect(handlers.onClearRecentFiles).not.toHaveBeenCalled();
    expect(byId('menu-dropdown').classList.contains('hidden')).toBe(true);
    expect(card()).toBeNull();
  });

  it('clears the list from its last entry and closes the menu', () => {
    openCard();
    cardEntries().at(-1)?.click();

    expect(handlers.onClearRecentFiles).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenRecentFile).not.toHaveBeenCalled();
    expect(byId('menu-dropdown').classList.contains('hidden')).toBe(true);
  });

  it('reads the list again each time it opens, so a file another window opened is there', () => {
    openCard();
    trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    stored = ['/home/a/other.md', ...LIST];
    trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(cardEntries()[0].title).toBe('/home/a/other.md');
  });

  it('goes away when another section opens, and when the menu closes', () => {
    openCard();
    byId('menu-section-edit').click();
    expect(card()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    openCard();
    byId('menu-toggle').click();
    expect(card()).toBeNull();
  });
});

describe('the keyboard goes in sideways and comes back (#381)', () => {
  const key = (el: HTMLElement, name: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

  it('enters on the arrow right, moves with the arrows, and leaves on Escape to Open Recent', () => {
    openFileSection();
    trigger().focus();
    key(trigger(), 'ArrowRight');
    expect(document.activeElement).toBe(cardEntries()[0]);

    key(cardEntries()[0], 'ArrowDown');
    expect(document.activeElement).toBe(cardEntries()[1]);
    key(cardEntries()[1], 'ArrowUp');
    key(cardEntries()[0], 'ArrowUp');
    expect(document.activeElement).toBe(cardEntries().at(-1));

    key(document.activeElement as HTMLElement, 'Escape');
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    // Escape left the card, not the menu.
    expect(byId('menu-dropdown').classList.contains('hidden')).toBe(false);
  });

  it('enters from Enter too, which the browser turns into a click with no pointer', () => {
    openFileSection();
    trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(document.activeElement).toBe(cardEntries()[0]);
  });
});

describe('the folder beside a name (#381)', () => {
  it('is the parent folder where that tells the entries apart', () => {
    expect(recentLabels(['/home/a/notes/x.md', '/home/a/work/y.md'])).toEqual([
      { name: 'x.md', folder: 'notes' },
      { name: 'y.md', folder: 'work' },
    ]);
  });

  it('reaches further up while two of the same name would read the same', () => {
    expect(
      recentLabels(['C:\\one\\notes\\README.md', 'C:\\two\\notes\\README.md', 'C:\\notes\\x.md']),
    ).toEqual([
      { name: 'README.md', folder: 'one\\notes' },
      { name: 'README.md', folder: 'two\\notes' },
      { name: 'x.md', folder: 'notes' },
    ]);
  });

  it('stops at the top of the path', () => {
    expect(recentLabels(['C:\\README.md', 'D:\\README.md'])).toEqual([
      { name: 'README.md', folder: 'C:' },
      { name: 'README.md', folder: 'D:' },
    ]);
  });
});
