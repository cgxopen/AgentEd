import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeManager } from '../app/theme-manager';
import stylesCss from '../styles.css?raw';
import { splitTopLevel, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
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
      'OLED Black',
    ]);
    // Paper Warm has no tooltip, since the Mode note says the same (#650);
    // OLED Black keeps its own, pinned in appearance-oled-mode.test.ts.
    expect(options[1].hasAttribute('title')).toBe(false);
    expect(options[3].title).not.toBe('');
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

/**
 * The space between the Mode and Palette sections is not observable here, since
 * happy-dom lays nothing out; the owner pass on the artifact is where it is
 * verified. What these rows hold is the other half: the rules that give the
 * Palette label its top margin, read out of the shipped sheet and run against
 * the popover the menu rendered, in a palette with a dark version and in two
 * without one, where the Mode note is shown (#650).
 */
describe('setupAppearanceMenu — the space above the Palette label (#650)', () => {
  const rules = stylesheetRules(stylesCss).filter(
    (rule) =>
      rule.declarations.has('margin-top') && rule.selector.includes('.appearance-section-label'),
  );
  beforeEach(() => localStorage.clear());

  it.each(['default', 'paper', 'oled'])(
    'in %s, one rule reaches the label and each one used',
    (palette) => {
      localStorage.setItem('agented:palette', palette);
      const { popover } = mount();
      setupAppearanceMenu(new ThemeManager());
      const label = popover.querySelectorAll('.appearance-section-label')[1];

      expect(label?.textContent).toBe('Palette');
      expect(valuesReaching(rules, label, 'margin-top')).toEqual(['9px']);
      const unused = rules
        .flatMap((rule) => splitTopLevel(rule.selector))
        .filter((selector) => popover.querySelector(selector) === null);
      expect(unused).toEqual([]);
    },
  );
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
    // A palette with a dark version: with nothing stored the palette is Paper
    // Warm, which greys Dark (#642), held in `appearance-first-launch.test.ts`.
    localStorage.setItem('agented:palette', 'default');
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
    // The palette stored is the one the test stored, untouched by a mode.
    expect(localStorage.getItem('agented:palette')).toBe('default');
  });

  it('applies a Palette choice immediately and persists it', () => {
    const { button, popover } = mount();
    const tm = new ThemeManager();
    setupAppearanceMenu(tm);
    button.click();

    const ghBtn = popover.querySelector<HTMLButtonElement>(
      '.appearance-palette[data-palette="oled"]',
    )!;
    ghBtn.click();

    expect(tm.getPalette()).toBe('oled');
    expect(localStorage.getItem('agented:palette')).toBe('oled');
    expect(isHidden(popover)).toBe(false);
    expect(ghBtn.classList.contains('active')).toBe(true);
  });

  it('cycles through all four palettes, each applied + persisted', () => {
    const { button, popover } = mount();
    const tm = new ThemeManager();
    setupAppearanceMenu(tm);
    button.click();

    for (const palette of ['default', 'paper', 'solarized', 'oled'] as const) {
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
