/**
 * #715 — Insert → Metadata, and the card of the two blocks it opens beside the
 * menu.
 *
 * Driven the way a person drives it: the shipped header from `index.html`, the
 * real `setupMenu`, the toggle, the Insert section, the entry. What is not seen
 * here is where the card lands on screen and how tall the section is, which
 * happy-dom does not lay out: those were measured in Chromium on the step zero,
 * and are the owner pass on the artifact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { type MenuCallbacks, setupMenu } from './menu';
import { METADATA_MENU_ID } from './menu-metadata';
import { SIDE_CARD_CLASS } from './menu-side-card';

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
  handlers = spies();
  setupMenu(
    handlers,
    () => ({ canUndo: true, canRedo: true }),
    () => ({}),
    () => ['C:\\notes\\plan.md'],
  );
});

afterEach(() => {
  document.body.innerHTML = '';
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const trigger = () => byId('menu-insert-metadata') as HTMLButtonElement;
const card = () => document.getElementById(METADATA_MENU_ID);
const rows = () => [...(card()?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
const menuOpen = () => !byId('menu-dropdown').classList.contains('hidden');

function openInsertSection(): void {
  byId('menu-toggle').click();
  byId('menu-section-insert').click();
}

/** Metadata pressed with the pointer, which leaves focus where it was. */
function openCard(): void {
  openInsertSection();
  trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
}

describe('Insert → Metadata opens a card of two blocks (#715)', () => {
  it('keeps its place and its word in Insert, and says it opens a list', () => {
    openInsertSection();
    expect(byId('menu-insert-horizontal-rule').nextElementSibling).toBe(trigger());
    expect(trigger().textContent?.trim()).toBe('Metadata');
    expect(trigger().getAttribute('aria-haspopup')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(METADATA_MENU_ID);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('adds no entry to the Insert section: it still holds nine', () => {
    openInsertSection();
    expect(byId('menu-panel-insert').querySelectorAll(':scope > button')).toHaveLength(9);
  });

  it('offers Document, then Agent instructions, and runs nothing until one is chosen', () => {
    openCard();
    expect(card()?.classList.contains(SIDE_CARD_CLASS)).toBe(true);
    expect(card()?.getAttribute('role')).toBe('group');
    expect(rows().map((row) => row.textContent)).toEqual(['Document', 'Agent instructions']);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(handlers.onInsertMetadata).not.toHaveBeenCalled();
    expect(menuOpen()).toBe(true);
  });

  it.each([
    ['Document', 'document'],
    ['Agent instructions', 'agent'],
  ])('%s asks for its block once and closes the menu', (label, kind) => {
    openCard();
    const row = rows().find((r) => r.textContent === label);
    row?.click();

    expect(handlers.onInsertMetadata).toHaveBeenCalledTimes(1);
    expect(handlers.onInsertMetadata).toHaveBeenCalledWith(kind);
    expect(menuOpen()).toBe(false);
    expect(card()).toBeNull();
  });

  it('enters on the arrow right, moves with the arrows, and leaves on Escape to Metadata', () => {
    openInsertSection();
    trigger().focus();
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(rows()[0]);

    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows()[1]);

    rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(menuOpen()).toBe(true);
  });

  it('goes away when another section opens, and when the menu closes', () => {
    openCard();
    byId('menu-section-edit').click();
    expect(card()).toBeNull();

    byId('menu-section-insert').click();
    trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(card()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBeNull();
    expect(menuOpen()).toBe(false);
  });

  it('and the recent files card are never shown together', () => {
    byId('menu-toggle').click();
    byId('menu-section-file').click();
    byId('menu-open-recent').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.getElementById('menu-recent')).not.toBeNull();

    byId('menu-section-insert').click();
    trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.getElementById('menu-recent')).toBeNull();
    expect(card()).not.toBeNull();
  });
});
