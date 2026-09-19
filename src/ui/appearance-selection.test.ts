/**
 * Issue #374 - the selected option of the Appearance menu draws no fill; its
 * own mark says it is selected.
 *
 * **Said at the head: colour is not observable here.** Whether the selected
 * Mode and Palette read as selected with no fill is the owner pass on the
 * artifact. What these rows hold is the rule read out of the sheet, run against
 * the popover `setupAppearanceMenu` builds, with a selected Mode and Palette,
 * and the colour of its mark resolved per palette. Until #379 the options were
 * written here by hand, so a change to how the menu builds them reached no row. The dot is drawn in `::before`, which no
 * element matches, so its rule is read by its selector.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { ThemeManager } from '../app/theme-manager';
import stylesCss from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, paletteTokens, resolveColour } from '../test-support/theme-colours';
import { setupAppearanceMenu } from './appearance-menu';

const rules = stylesheetRules(stylesCss);
/** Colours never change inside a `@media` block of this sheet. */
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);
const paletteNames = [...palettes.keys()];

/** WCAG 1.4.11, for the mark that says selected. */
const NON_TEXT = 3;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('agented:theme', 'light');
  document.body.innerHTML = [
    shippedElement(shippedPage, '<button id="appearance-menu-trigger"'),
    shippedElement(shippedPage, '<aside id="appearance-popover"'),
  ].join('');
  setupAppearanceMenu(new ThemeManager());
});

function selected(selector: string): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>(selector);
  if (found.length !== 1) throw new Error(`${found.length} options match ${selector}`);
  return found[0];
}

const mode = () => selected('.appearance-mode.active');
const palette = () => selected('.appearance-palette.active');

/** The value the last rule reaching `el` gives `property`, in sheet order. */
function last(el: Element, property: string): string | undefined {
  return valuesReaching(atEveryWidth, el, property).at(-1);
}

/** The declaration a rule with exactly this selector gives `property`. */
function ruleValue(selector: string, property: string): string | undefined {
  return atEveryWidth.find((rule) => rule.selector === selector)?.declarations.get(property);
}

describe('the selected Appearance option draws no fill (#374)', () => {
  it('gives a selected option no fill, only the bold', () => {
    for (const option of [mode(), palette()]) {
      expect(last(option, 'background'), option.className).toBe('none');
      expect(last(option, 'background-color'), option.className).toBeUndefined();
      expect(last(option, 'font-weight'), option.className).toBe('600');
    }
  });

  it('keeps the mark of each: the filled dot of a Mode and the ring of a Palette', () => {
    expect(ruleValue('.appearance-mode.active::before', 'background')).toBe('var(--accent)');
    expect(ruleValue('.appearance-palette.active .swatch', 'box-shadow')).toBe(
      '0 0 0 2px var(--accent)',
    );
  });

  it.each(paletteNames)('%s: the mark stands off the popover at 3', (name) => {
    const tokens = palettes.get(name)!;
    const popover = document.getElementById('appearance-popover') as HTMLElement;
    const ground = resolveColour(last(popover, 'background') as string, tokens);
    const mark = resolveColour(
      ruleValue('.appearance-mode.active::before', 'background') as string,
      tokens,
    );
    expect(contrast(mark, ground), name).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
