import { beforeEach, describe, expect, it, vi } from 'vitest';
// The shipped page, so a menu entry deleted from the real markup fails here
// rather than at the user's first click (setupMenu asserts every id exists).
import shippedPage from '../../index.html?raw';
import { type MenuCallbacks, setupMenu } from './menu';

function callbacks(): MenuCallbacks {
  return {
    onNew: vi.fn(),
    onNewFromTemplate: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onClose: vi.fn(),
    onFind: vi.fn(),
    onReplace: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onToggleSidebar: vi.fn(),
    onAbout: vi.fn(),
    onPasteDiagnostics: vi.fn(),
  };
}

/**
 * The page's `<header>`, which holds the hamburger and its dropdown. Only that
 * fragment: mounting the whole document would send happy-dom fetching the
 * stylesheet and the icons.
 */
function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

beforeEach(() => {
  // innerHTML does not execute scripts, so this is just the markup — the same
  // elements main.ts binds at boot.
  document.body.innerHTML = shippedHeaderMarkup();
});

describe('setupMenu', () => {
  it('binds every entry the hamburger menu ships', () => {
    expect(() => setupMenu(callbacks())).not.toThrow();
  });

  it('opens About from the Help entry', () => {
    const handlers = callbacks();
    setupMenu(handlers);

    document.getElementById('menu-about')!.click();

    expect(handlers.onAbout).toHaveBeenCalledTimes(1);
  });

  it('closes the menu when About is chosen', () => {
    setupMenu(callbacks());
    const dropdown = document.getElementById('menu-dropdown')!;

    document.getElementById('menu-toggle')!.click();
    expect(dropdown.classList.contains('hidden')).toBe(false);

    document.getElementById('menu-about')!.click();
    expect(dropdown.classList.contains('hidden')).toBe(true);
  });
});
