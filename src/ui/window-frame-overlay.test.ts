/**
 * #615 - on macOS the system buttons stand over the header, which becomes the
 * title bar: what `drawOverlayFrame` adds to it.
 *
 * **Said first: the window, the buttons and the layout are not observable
 * here.** Where the buttons stand, whether the bar drags and zooms, and what
 * full screen does were measured on a macOS runner on the head of the pull
 * request, and are the owner pass on a Mac. These rows hold the half the
 * harness can see: the markup added to the shipped header, the drag region on
 * every passive part and on no control, the class that follows full screen,
 * and the room for the buttons read out of the stylesheet and run against the
 * bar the code drew. Either half alone asserts nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import type { TitleBarOverlay } from '../platform';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { DRAG_REGION, drawOverlayFrame } from './window-frame';

const rules = stylesheetRules(stylesCss);

function mountHeader(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  document.body.innerHTML = shippedPage.slice(open, close + '</header>'.length);
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

/** A window in or out of full screen, whose resizes the test raises. */
function overlayWindow(fullscreen: boolean) {
  const state = { fullscreen, listeners: [] as Array<() => void> };
  const overlay: TitleBarOverlay = {
    fullscreen: async () => state.fullscreen,
    onResize: (listener) => {
      state.listeners.push(listener);
    },
  };
  return { overlay, state };
}

/** Let the reads of full screen settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(mountHeader);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('the header under the system buttons (#615)', () => {
  it('draws the brand last in the bar, after the last control, and no caption buttons', () => {
    drawOverlayFrame(overlayWindow(false).overlay);
    const right = element('#menubar .header-right');

    const brand = element('#menubar .header-right > .window-brand:last-child');
    expect(brand.previousElementSibling).toBe(element('#sidebar-toggle'));
    expect(brand.querySelector('.window-brand-name')?.textContent).toBe('AgentEd');
    expect(right.querySelectorAll('.window-brand')).toHaveLength(1);
    expect(document.querySelector('.header-left .window-brand')).toBeNull();
    expect(document.querySelector('.window-caption')).toBeNull();
  });

  it('marks the bar, its groups, the brand, the document name and the readouts', () => {
    drawOverlayFrame(overlayWindow(false).overlay);
    for (const selector of [
      '#menubar',
      '#menubar .header-left',
      '#menubar .header-right',
      '.window-brand',
      '.window-brand-mark',
      '.window-brand-name',
      '#filename',
      '#header-indicators',
      '#count-readout',
      '#token-number',
      '#badge-metadata',
    ]) {
      expect(element(selector).hasAttribute(DRAG_REGION), selector).toBe(true);
    }
  });

  it('puts the drag region on nothing that takes a press, and on nothing inside the menu', () => {
    drawOverlayFrame(overlayWindow(false).overlay);
    const marked = [...document.querySelectorAll(`[${DRAG_REGION}]`)];
    const controlsMarked = marked.filter(
      (el) =>
        el.matches('button, a, input, select, textarea, [role="button"], [tabindex]') ||
        el.closest('#menu-dropdown') !== null,
    );

    expect(marked.length).toBeGreaterThan(10);
    expect(controlsMarked.map((el) => el.id || el.className)).toEqual([]);
  });
});

describe('the room for the buttons, closed in full screen (#615)', () => {
  it('starts the bar at 80 px out of full screen, the stylesheet run against the drawn bar', async () => {
    drawOverlayFrame(overlayWindow(false).overlay);
    await settle();
    const bar = element('#menubar');

    expect(bar.classList.contains('window-frame-overlay')).toBe(true);
    expect(bar.classList.contains('window-frame-fullscreen')).toBe(false);
    expect(valuesReaching(rules, bar, 'padding-left')).toEqual(['80px']);
  });

  it('starts it at 16 px in full screen, and follows the window on each resize', async () => {
    const { overlay, state } = overlayWindow(true);
    drawOverlayFrame(overlay);
    await settle();
    const bar = element('#menubar');

    expect(bar.classList.contains('window-frame-fullscreen')).toBe(true);
    // The later, more specific rule is the one that applies in full screen.
    expect(valuesReaching(rules, bar, 'padding-left')).toEqual(['80px', '16px']);

    state.fullscreen = false;
    for (const listener of state.listeners) listener();
    await settle();
    expect(bar.classList.contains('window-frame-fullscreen')).toBe(false);
  });

  it('leaves the bar as the web build and Linux draw it when it is not called', () => {
    const bar = element('#menubar');
    expect(bar.classList.contains('window-frame-overlay')).toBe(false);
    expect(valuesReaching(rules, bar, 'padding-left')).toEqual([]);
    expect(document.querySelector(`[${DRAG_REGION}]`)).toBeNull();
  });
});
