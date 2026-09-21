/**
 * Issue #130 — the `...` overflow menu offered a control its own module
 * had withdrawn.
 *
 * `renderOverflowPopover` decided what to offer from
 * `offsetParent === null`, which answers *this element is not laid out*.
 * That is true of two different things:
 *
 *  - an indicator the **collapse breakpoint** took out of the bar — live,
 *    its text current, and the entire reason this menu exists;
 *  - an indicator its **own module withdrew** because it has nothing to
 *    report — text frozen at whatever it last said, click going nowhere.
 *
 * The menu treated both as the first. Below 600px the clone in that menu
 * is the only route to the popover, so a withdrawn indicator was reached
 * exclusively through a stale copy of itself, and after a scan returned
 * nothing that copy was a dead control reading `📎 1 related`. Measured
 * in the browser at 308f214.
 *
 * **What is covered here, and what is not.** `offsetParent` is layout,
 * and happy-dom has no layout: it answers `undefined` for every element,
 * so `renderOverflowPopover` clones nothing at all under test and a test
 * driving the menu as a whole would assert an empty menu and pass for
 * the wrong reason. The decision is therefore tested where it is made —
 * `isOfferedInOverflow`, with both facts set explicitly — and the menu
 * around it is covered by the browser pass on the pull request. A test
 * that cannot construct the state does not stand in for one that can.
 */
import { describe, expect, it } from 'vitest';
import { isOfferedInOverflow } from './header-wiring';

/**
 * An indicator with `offsetParent` set the way a browser would set it.
 * `laidOut` false is what the collapse breakpoint produces; happy-dom
 * cannot produce it on its own, so it is stated.
 */
function indicator(options: { laidOut: boolean; withdrawn: boolean; label?: string }): HTMLElement {
  const el = document.createElement('span');
  el.className = 'indicator';
  el.textContent = options.label ?? '📎 1 related';
  if (options.withdrawn) {
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }
  Object.defineProperty(el, 'offsetParent', {
    value: options.laidOut ? document.body : null,
    configurable: true,
  });
  return el;
}

describe('isOfferedInOverflow', () => {
  it('offers an indicator the breakpoint took out of the bar — what the menu is for', () => {
    expect(isOfferedInOverflow(indicator({ laidOut: false, withdrawn: false }))).toBe(true);
  });

  it('does not offer one that is visible in the bar already', () => {
    expect(isOfferedInOverflow(indicator({ laidOut: true, withdrawn: false }))).toBe(false);
  });

  it('never offers one its own module has withdrawn', () => {
    // The defect: this is the case that used to be indistinguishable
    // from the first, and it is the one that produced a dead control
    // carrying a count from a scan that had already been superseded.
    expect(isOfferedInOverflow(indicator({ laidOut: false, withdrawn: true }))).toBe(false);
  });

  it('does not offer a withdrawn one even if something lays it out', () => {
    // Belt and braces: withdrawal is the module's statement about
    // whether the control is part of the interface, and layout does not
    // overrule it.
    expect(isOfferedInOverflow(indicator({ laidOut: true, withdrawn: true }))).toBe(false);
  });

  it('reads the withdrawal, not the label', () => {
    // An indicator with no text is not the same as a withdrawn one, and
    // the emptied label after #130 must not be what makes this work —
    // otherwise the fix depends on a side effect rather than a statement.
    const blank = indicator({ laidOut: false, withdrawn: false, label: '' });
    expect(isOfferedInOverflow(blank)).toBe(true);
  });
});
