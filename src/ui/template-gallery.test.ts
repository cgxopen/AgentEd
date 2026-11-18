import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { TEMPLATES } from '../templates/index';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { showTemplateGallery } from './template-gallery';

/**
 * #754 — New from Template draws its three cards in one row at every window
 * size, by owner decision of 2026-11-18.
 *
 * **Said at the head: one row is layout, and happy-dom performs none.** Whether
 * the three cards fit, scroll or cut a text was measured in Chromium against
 * the built page, at 600x400, 800x600 and 1200x800, and the figures are in
 * R-C18; at the minimum the gallery has 1.42 px to spare there. WebView2 draws a
 * classic scrollbar, and on the owner pass of #755 it scrolled a little at the
 * minimum window with the row kept, which the owner accepted.
 *
 * What these rows join are the two halves that are observable: the column rule,
 * read out of the shipped stylesheet rather than restated, and the grid the
 * gallery actually renders, which the rule is run against. Either half alone
 * asserts nothing about the row.
 */

const rules = stylesheetRules(stylesCss);

let pending: Promise<unknown> | null = null;

function openGallery(): HTMLElement {
  pending = showTemplateGallery();
  const grid = document.querySelector<HTMLElement>('.template-gallery-grid');
  if (!grid) throw new Error('the gallery rendered no grid');
  return grid;
}

afterEach(async () => {
  document.querySelector<HTMLButtonElement>('.template-gallery-close')?.click();
  await pending;
  pending = null;
  document.body.innerHTML = '';
});

describe('the gallery draws its cards in one row of three (#754)', () => {
  it('renders one card per template, in the order of TEMPLATES', () => {
    const grid = openGallery();
    const cards = [...grid.querySelectorAll<HTMLElement>('.template-gallery-card')];
    expect(cards.map((card) => card.dataset.template)).toEqual(TEMPLATES.map((t) => t.id));
    expect(cards).toHaveLength(3);
  });

  it('the grid it renders takes three equal columns, at any window width, and no other rule', () => {
    // valuesReaching gathers every rule that reaches the element, inside a
    // media query or not, so a width at which the row reflows would show here
    // as a second value.
    const grid = openGallery();
    expect(valuesReaching(rules, grid, 'grid-template-columns')).toEqual([
      'repeat(3, minmax(0, 1fr))',
    ]);
  });

  it('the column count of the rule is the number of cards', () => {
    // One row holds only while the count in the rule and the cards drawn agree:
    // a fourth card would wrap to a second row under this rule.
    const grid = openGallery();
    const [value] = valuesReaching(rules, grid, 'grid-template-columns');
    const count = Number(/^repeat\((\d+),/.exec(value ?? '')?.[1]);
    expect(count).toBe(grid.querySelectorAll('.template-gallery-card').length);
  });
});
