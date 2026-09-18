/**
 * #362 — the menu card: no line between the section headers, and the section
 * arrow on the left, drawn as an inline SVG, pointing right while its section
 * is closed and down while it is open.
 *
 * **Said first: colour and layout are not observable in this harness.** What
 * these rows hold is the rule read out of the shipped stylesheet and run
 * against the element the shipped page carries, and the markup itself. How the
 * card looks, and whether the arrow and the indent read right, is the owner
 * pass on the artifact. The contrast of the arrow is computed per palette from
 * the tokens, the #321 instrument.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';

const rules = stylesheetRules(stylesCss);
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);

/** The page's `<header>`, which holds the menu. Mounting it all would send happy-dom fetching. */
function mount(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  document.body.innerHTML = shippedPage.slice(open, close + '</header>'.length);
}

function headers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#menu-dropdown .menu-section')];
}

beforeEach(mount);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('no line between the section headers (#362)', () => {
  it('draws nothing on any header, above or below it', () => {
    expect(headers()).toHaveLength(5);
    for (const header of headers()) {
      for (const property of ['background-image', 'border-top', 'border-bottom', 'box-shadow']) {
        expect(valuesReaching(atEveryWidth, header, property), `${header.id} ${property}`).toEqual(
          [],
        );
      }
    }
  });
});
