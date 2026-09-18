/**
 * #362 — hover switches between sections once one is open.
 *
 * **Every row here runs on fake timers** (`vi.useFakeTimers`), so the delay is
 * stepped rather than waited for: a row advances to one millisecond short of
 * it and then past it. What the rows cannot see is the pointer itself: the
 * events are dispatched the way Chromium 153 was measured dispatching them on
 * the built page, including the sequence a header receives when it slides
 * under a pointer that stands still - `pointerover` and `pointerenter`, at the
 * same coordinates, and no `pointermove`. How it feels, and what WebView2
 * does, is the manual pass on Windows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { type MenuCallbacks, setupMenu } from './menu';
import { HOVER_SWITCH_DELAY_MS } from './menu-hover';

function mount(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  document.body.innerHTML = shippedPage.slice(open, close + '</header>'.length);
  setupMenu(
    new Proxy({}, { get: () => () => {} }) as unknown as MenuCallbacks,
    () => ({ canUndo: true, canRedo: true }),
    () => ({}),
  );
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped header has no #${id}`);
  return found;
}

/** Which section is open, by the attribute the menu writes. */
function openSection(): string | null {
  const open = document.querySelector('#menu-dropdown .menu-section[aria-expanded="true"]');
  return open?.id ?? null;
}

const menuShown = () => !element('menu-dropdown').classList.contains('hidden');

/** The pointer moving onto `target` at (x, y). */
function moveOnto(target: HTMLElement, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: x, clientY: y }));
  target.dispatchEvent(new PointerEvent('pointerenter', { clientX: x, clientY: y }));
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
}

/** What a header receives when it slides under a pointer resting at (x, y). */
function slideUnder(target: HTMLElement, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: x, clientY: y }));
  target.dispatchEvent(new PointerEvent('pointerenter', { clientX: x, clientY: y }));
}

function leave(target: HTMLElement): void {
  target.dispatchEvent(new PointerEvent('pointerleave', { clientX: 0, clientY: 0 }));
}

/** Open the menu and then Edit, by the press a person makes. */
function openEdit(): void {
  element('menu-toggle').click();
  element('menu-section-edit').click();
}

beforeEach(() => {
  vi.useFakeTimers();
  mount();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('hover switches sections once one is open (#362)', () => {
  it('switches to the header the pointer rests on, after the delay and not before', () => {
    openEdit();
    moveOnto(element('menu-section-insert'), 40, 300);

    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS - 1);
    expect(openSection()).toBe('menu-section-edit');
    vi.advanceTimersByTime(1);
    expect(openSection()).toBe('menu-section-insert');
    expect(menuShown()).toBe(true);
  });

  it('switches nothing when the pointer leaves the header before the delay', () => {
    openEdit();
    const insert = element('menu-section-insert');
    moveOnto(insert, 40, 300);
    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS - 50);
    leave(insert);

    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(openSection()).toBe('menu-section-edit');
  });

  it('switches nothing for a header that slides under a pointer standing still', () => {
    // The sequence measured in Chromium: the pointer rests on an entry of Edit,
    // and a header arrives under it with no movement.
    openEdit();
    element('menu-find').dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 128 }),
    );
    slideUnder(element('menu-section-insert'), 40, 128);

    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(openSection()).toBe('menu-section-edit');
  });

  it('and nothing for a move an engine sends after layout at the same coordinates', () => {
    // A move alone, with no `pointerover`, so this row and the one above each
    // stand on one guard: the coordinates here, the event that arms there.
    openEdit();
    element('menu-find').dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 128 }),
    );
    element('menu-section-insert').dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 128 }),
    );

    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(openSection()).toBe('menu-section-edit');
  });

  it('makes one switch and no cascade, with the pointer still after it', () => {
    openEdit();
    moveOnto(element('menu-section-table'), 40, 400);
    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS);
    expect(openSection()).toBe('menu-section-table');

    // Edit folded and every header below moved: another arrives under the
    // pointer, which has not moved.
    slideUnder(element('menu-section-help'), 40, 400);
    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(openSection()).toBe('menu-section-table');
  });

  it('opens nothing while no section is open: the first press does that', () => {
    element('menu-toggle').click();
    moveOnto(element('menu-section-insert'), 40, 300);

    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(openSection()).toBeNull();
  });

  it('never opens a closed menu, and leaving the card closes nothing', () => {
    moveOnto(element('menu-section-insert'), 40, 300);
    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(menuShown()).toBe(false);

    openEdit();
    leave(element('menu-dropdown'));
    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(menuShown()).toBe(true);
    expect(openSection()).toBe('menu-section-edit');
  });

  it('forgets a switch waiting to happen when the menu closes', () => {
    openEdit();
    moveOnto(element('menu-section-insert'), 40, 300);
    element('menu-toggle').click();

    vi.advanceTimersByTime(HOVER_SWITCH_DELAY_MS * 4);
    expect(openSection()).toBeNull();
  });
});
