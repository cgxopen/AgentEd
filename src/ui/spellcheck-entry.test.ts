/**
 * #360 — spell check moves from the header into the Edit menu.
 *
 * **The entry, its words and its state are observable here**, so these rows
 * drive the shipped header markup through the real `setupMenu`, the real
 * `setupSpellcheckToggle` and the command `main.ts` spreads into the menu,
 * `spellcheckMenuCallbacks`. How tall Edit is and whether the menu scrolls are
 * layout, measured in Chromium on the issue and owed to the manual pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { AppState } from '../app/state';
import { type MenuCallbacks, setupMenu } from './menu';
import { setupSpellcheckToggle, spellcheckMenuCallbacks } from './statusbar';

/** The page's `<header>`, which holds the bar and the menu, plus an editor element. */
function mount(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  document.body.innerHTML = `${shippedPage.slice(open, close + '</header>'.length)}<div class="ProseMirror" spellcheck="false"></div>`;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped header has no #${id}`);
  return found;
}

/** Every handler a spy, except the one this issue is about, which is the real command. */
function wire(state: AppState): void {
  const real = spellcheckMenuCallbacks(state);
  const handlers = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key in real) return real[key as keyof typeof real];
      target[key] ??= vi.fn();
      return target[key];
    },
  }) as unknown as MenuCallbacks;
  setupMenu(
    handlers,
    () => ({ canUndo: true, canRedo: true }),
    () => ({ imageDescription: true }),
  );
  setupSpellcheckToggle(state);
}

/** Open the menu, then Edit, then choose the entry, as a person does. */
function choose(): void {
  element('menu-toggle').click();
  element('menu-section-edit').click();
  element('menu-spellcheck').click();
}

const entry = () => element('menu-spellcheck');
const word = () => entry().querySelector('.menu-state')?.textContent;
const editor = () => document.querySelector('.ProseMirror') as HTMLElement;

beforeEach(mount);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('the header no longer carries spell check (#360)', () => {
  it('has no spell-check control anywhere in the bar, so none can collapse into the list', () => {
    // The overflow list is built from `#header-indicators .indicator` when it
    // opens, so a control that is not in the bar cannot reach it either.
    expect(document.getElementById('spellcheck-toggle')).toBeNull();
    const bar = [...document.querySelectorAll('#menubar > :not(#menu-dropdown) *')];
    expect(
      bar.filter((el) => /spell/i.test(el.textContent ?? '') && el.children.length === 0),
    ).toEqual([]);
  });
});

describe('Edit carries it, and says its state (#360)', () => {
  it('sits last in Edit, after the eight entries it found there, in their order', () => {
    const ids = [...element('menu-panel-edit').querySelectorAll('button')].map((b) => b.id);
    expect(ids).toEqual([
      'menu-find',
      'menu-replace',
      'menu-find-next',
      'menu-find-prev',
      'menu-undo',
      'menu-redo',
      'menu-select-all',
      'menu-image-description',
      'menu-spellcheck',
    ]);
  });

  it('starts off in a new window: Spell check, Off, not pressed, and the editor not checking', () => {
    wire(new AppState());

    expect(entry().firstChild?.textContent?.trim()).toBe('Spell check');
    expect(word()).toBe('Off');
    expect(entry().getAttribute('aria-pressed')).toBe('false');
    expect(entry().querySelector('.menu-state')?.getAttribute('aria-hidden')).toBe('true');
    expect(editor().getAttribute('spellcheck')).toBe('false');
  });

  it('chosen, turns the session setting on; chosen again, off', () => {
    const state = new AppState();
    wire(state);

    choose();
    expect(state.spellcheckEnabled).toBe(true);
    expect(word()).toBe('On');
    expect(entry().getAttribute('aria-pressed')).toBe('true');
    expect(editor().getAttribute('spellcheck')).toBe('true');

    choose();
    expect(state.spellcheckEnabled).toBe(false);
    expect(word()).toBe('Off');
    expect(entry().getAttribute('aria-pressed')).toBe('false');
    expect(editor().getAttribute('spellcheck')).toBe('false');
  });

  it('writes the state when the setting changes by any route, not only by the entry', () => {
    const state = new AppState();
    wire(state);

    state.setSpellcheck(true);

    expect(word()).toBe('On');
    expect(entry().getAttribute('aria-pressed')).toBe('true');
  });

  it('is never greyed, so it takes no part in the reading the menu makes when it opens', () => {
    wire(new AppState());
    element('menu-toggle').click();
    element('menu-section-edit').click();

    expect((entry() as HTMLButtonElement).disabled).toBe(false);
  });
});
