import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeManager } from '../app/theme-manager';
import { setupAppearanceMenu } from './appearance-menu';

function mount(): { button: HTMLButtonElement; popover: HTMLElement } {
  document.body.innerHTML = `
    <button id="appearance-menu-trigger" type="button"></button>
    <aside id="appearance-popover" class="appearance-popover hidden"></aside>
  `;
  return {
    button: document.getElementById('appearance-menu-trigger') as HTMLButtonElement,
    popover: document.getElementById('appearance-popover') as HTMLElement,
  };
}

function isHidden(el: HTMLElement): boolean {
  return el.classList.contains('hidden');
}

describe('setupAppearanceMenu — structure', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('returns a no-op handle when the DOM targets are missing', () => {
    const menu = setupAppearanceMenu(new ThemeManager());
    expect(() => menu.refresh()).not.toThrow();
  });

  it('renders 3 Mode options and 4 Palette options', () => {
    const { popover } = mount();
    setupAppearanceMenu(new ThemeManager());
    expect(popover.querySelectorAll('.appearance-mode')).toHaveLength(3);
    expect(popover.querySelectorAll('.appearance-palette')).toHaveLength(4);
  });

  it('names the palettes as a person reads them, the warm one Paper Warm (#379)', () => {
    const { popover } = mount();
    setupAppearanceMenu(new ThemeManager());
    const options = [...popover.querySelectorAll<HTMLElement>('.appearance-palette')];

    expect(options.map((option) => option.textContent)).toEqual([
      'Default',
      'Paper Warm',
      'Solarized',
      'GitHub',
    ]);
    expect(options[1].title).toBe('Warm palette, light mode only');
  });

  it('marks the ThemeManager current mode + palette as active', () => {
    localStorage.setItem('agented:theme', 'dark');
    localStorage.setItem('agented:palette', 'solarized');
    const { popover } = mount();
    setupAppearanceMenu(new ThemeManager());
    expect(popover.querySelector('.appearance-mode.active')?.getAttribute('data-mode')).toBe(
      'dark',
    );
    expect(popover.querySelector('.appearance-palette.active')?.getAttribute('data-palette')).toBe(
      'solarized',
    );
  });
});

describe('setupAppearanceMenu — open / close', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('toggles the popover on trigger click', () => {
    const { button, popover } = mount();
    setupAppearanceMenu(new ThemeManager());
    expect(isHidden(popover)).toBe(true);
    button.click();
    expect(isHidden(popover)).toBe(false);
    button.click();
    expect(isHidden(popover)).toBe(true);
  });

  it('closes on Escape', () => {
    const { button, popover } = mount();
    setupAppearanceMenu(new ThemeManager());
    button.click();
    expect(isHidden(popover)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isHidden(popover)).toBe(true);
  });

  it('closes on a click outside the popover and trigger', () => {
    const { button, popover } = mount();
    setupAppearanceMenu(new ThemeManager());
    button.click();
    expect(isHidden(popover)).toBe(false);
    document.body.click();
    expect(isHidden(popover)).toBe(true);
  });

  it('stays open when clicking inside the popover', () => {
    const { button, popover } = mount();
    setupAppearanceMenu(new ThemeManager());
    button.click();
    popover.click();
    expect(isHidden(popover)).toBe(false);
  });
});

describe('setupAppearanceMenu — selection apply + persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('applies a Mode choice immediately and persists it', () => {
    const { button, popover } = mount();
    const tm = new ThemeManager();
    setupAppearanceMenu(tm);
    button.click();

    const darkBtn = popover.querySelector<HTMLButtonElement>('.appearance-mode[data-mode="dark"]')!;
    darkBtn.click();

    expect(tm.getMode()).toBe('dark');
    expect(localStorage.getItem('agented:theme')).toBe('dark');
    // Popover stays open for quick exploration (D4).
    expect(isHidden(popover)).toBe(false);
    // Active marker moves to the new choice.
    expect(darkBtn.classList.contains('active')).toBe(true);
  });

  it('applies a Palette choice immediately and persists it', () => {
    const { button, popover } = mount();
    const tm = new ThemeManager();
    setupAppearanceMenu(tm);
    button.click();

    const ghBtn = popover.querySelector<HTMLButtonElement>(
      '.appearance-palette[data-palette="github"]',
    )!;
    ghBtn.click();

    expect(tm.getPalette()).toBe('github');
    expect(localStorage.getItem('agented:palette')).toBe('github');
    expect(isHidden(popover)).toBe(false);
    expect(ghBtn.classList.contains('active')).toBe(true);
  });

  it('cycles through all four palettes, each applied + persisted', () => {
    const { button, popover } = mount();
    const tm = new ThemeManager();
    setupAppearanceMenu(tm);
    button.click();

    for (const palette of ['default', 'paper', 'solarized', 'github'] as const) {
      popover
        .querySelector<HTMLButtonElement>(`.appearance-palette[data-palette="${palette}"]`)!
        .click();
      expect(tm.getPalette()).toBe(palette);
      expect(localStorage.getItem('agented:palette')).toBe(palette);
    }
  });

  it('reflects an external ThemeManager change via refresh subscription', () => {
    const { popover } = mount();
    const tm = new ThemeManager();
    setupAppearanceMenu(tm);

    tm.setMode('light');
    expect(popover.querySelector('.appearance-mode.active')?.getAttribute('data-mode')).toBe(
      'light',
    );
  });
});
