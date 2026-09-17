/**
 * Issue #347 — the files panel opens from the header, sits on the right, and is
 * drawn as a card.
 *
 * **Said at the head, because it is most of the change: colour, placement and
 * focus are not observable here.** happy-dom performs no layout, so every
 * rectangle it reports is zero: how wide the editor becomes when the panel
 * opens, whether the card clears the window edges, whether its shadow is
 * visible against the ground, and whether the two ends of the bar read as a
 * pair are all owed to the manual pass. The figures that decided each of them
 * were measured in Chromium against the built page and are written on the
 * issue.
 *
 * What the rows below assert is what is left once that is said, and it is not
 * nothing:
 *
 * - **the side is markup order**, which is a fact about the page rather than
 *   about layout — the panel is the last child of `#main-area`, and no
 *   stylesheet rule reverses the row it sits in;
 * - **the card is the declarations that reach the element the page renders**,
 *   read out of the shipped stylesheet rather than restated here and matched
 *   against the shipped markup, which is the pairing `stylesheet-rules.ts`
 *   exists for — either half alone asserts nothing;
 * - **the state on the control is an attribute**, and attributes are fully
 *   observable, so the wiring is asserted rather than described.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { wireSidebarButton } from '../app/header-wiring';
import stylesCss from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { setupSidebar } from './sidebar';

const rules = stylesheetRules(stylesCss);
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);

/** The header and the main area of the shipped page, which is all these rows need. */
function shippedShell(): string {
  return `${shippedElement(shippedPage, '<header id="menubar">')}${shippedElement(
    shippedPage,
    '<div id="main-area">',
  )}`;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped page has no #${id}`);
  return found;
}

/** The last value of `property` that any rule of the sheet gives the element. */
function declared(el: Element, property: string): string | undefined {
  return valuesReaching(atEveryWidth, el, property).at(-1);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = shippedShell();
});

// ─────────────────────────────────────────────────────────────────────────────
// The control, and its seat
// ─────────────────────────────────────────────────────────────────────────────

describe('the panel opens and closes from the last control of the header', () => {
  it('is the last child of the right-hand group, with Appearance one place before it', () => {
    const group = document.querySelector('.header-right') as HTMLElement;
    const ids = Array.from(group.children, (child) => child.id);
    expect(ids.at(-1)).toBe('sidebar-toggle');
    expect(ids.at(-2)).toBe('appearance-menu-trigger');
  });

  it('never collapses, because no breakpoint reaches it', () => {
    // The seat survives the indicator rules by sitting outside the run they
    // apply to, which is the same answer the overflow and Appearance controls
    // give. A control that collapsed would take the panel with it at exactly
    // the width where the window has least room to spare.
    const control = element('sidebar-toggle');
    expect(control.parentElement?.id).not.toBe('header-indicators');
    expect(control.className).not.toMatch(/indicator-collapse-/);
    const collapsing = rules.filter((rule) => rule.conditions.length > 0);
    expect(valuesReaching(collapsing, control, 'display')).toEqual([]);
  });

  it('names the surface it reveals, and carries the chord in its tooltip', () => {
    const control = element('sidebar-toggle');
    expect(control.getAttribute('aria-controls')).toBe('sidebar');
    expect(document.getElementById('sidebar')).not.toBeNull();
    expect(control.getAttribute('aria-label')).toBe('Files panel');
    // The way the Search control shows Ctrl+F. The chord itself is pinned in
    // `app/keyboard.test.ts`; this is that the user is told about it.
    expect(control.getAttribute('title')).toBe('Files panel (Ctrl+Shift+E)');
  });

  it('refuses to boot when the markup no longer holds it', () => {
    // The `required` shape of `ui/menu.ts`: a markup edit that drops the
    // control leaves the panel with the chord and nothing that says whether it
    // is open, and that is a failure which should name itself.
    element('sidebar-toggle').remove();
    expect(() => wireSidebarButton(setupSidebar())).toThrow(/#sidebar-toggle/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The state, read on the control
// ─────────────────────────────────────────────────────────────────────────────

describe('the control says whether the panel is open', () => {
  it('starts closed, opens on a press, and closes on the next one', () => {
    const sidebar = setupSidebar();
    wireSidebarButton(sidebar);
    const control = element('sidebar-toggle');

    expect(control.getAttribute('aria-expanded')).toBe('false');

    control.click();
    expect(sidebar.isVisible()).toBe(true);
    expect(control.getAttribute('aria-expanded')).toBe('true');

    control.click();
    expect(sidebar.isVisible()).toBe(false);
    expect(control.getAttribute('aria-expanded')).toBe('false');
  });

  it('follows the panel, not the press, so every other route moves it too', () => {
    // The state belongs to the panel: a document switch that draws a tree, the
    // folder offer, and `hide` all change what is on screen without anyone
    // touching the control. Each goes through `setVisible`, which is why one
    // subscription is enough.
    const sidebar = setupSidebar();
    wireSidebarButton(sidebar);
    const control = element('sidebar-toggle');

    sidebar.showTree([], 'project', '/project', true);
    expect(control.getAttribute('aria-expanded')).toBe('true');

    sidebar.hide();
    expect(control.getAttribute('aria-expanded')).toBe('false');

    sidebar.showAccessOffer();
    expect(control.getAttribute('aria-expanded')).toBe('true');

    sidebar.hide();
    sidebar.showNothingRelated();
    expect(control.getAttribute('aria-expanded')).toBe('true');
  });

  it('is lit by that attribute, by the rule that already lights the magnifier', () => {
    // The shade is read out of the sheet and its selector run against the
    // control the page renders — the pairing this suite exists for. What the
    // shade looks like in each palette was measured in Chromium and is on the
    // issue; that it reaches this control is here.
    const control = element('sidebar-toggle');
    control.setAttribute('aria-expanded', 'true');
    expect(declared(control, 'background-color')).toBe('var(--hover-overlay-strong)');
    expect(declared(control, 'color')).toBe('var(--text)');

    control.setAttribute('aria-expanded', 'false');
    expect(declared(control, 'background-color')).toBeUndefined();
  });

  it('keeps one glyph whichever state it is in', () => {
    // Under #332 the glyph says what a control is and the fill says what it is
    // doing. The markup holds one drawing, so a state cannot swap it.
    const control = element('sidebar-toggle');
    expect(control.querySelectorAll('svg')).toHaveLength(1);
    const before = control.innerHTML;
    setupSidebar().toggle();
    expect(control.innerHTML).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The side, and the card
// ─────────────────────────────────────────────────────────────────────────────

describe('the panel sits on the right and is drawn as a card', () => {
  it('is the last child of the main area, which is what the right-hand side is', () => {
    // The side is markup order in a flex row, and there is no `order` anywhere
    // to read against it — so this is the whole of what «on the right» means
    // in the page, and it is observable.
    const main = element('main-area');
    expect(Array.from(main.children, (child) => child.id)).toEqual(['editor-stack', 'sidebar']);
  });

  it('lets no rule of the stylesheet put it back on the left', () => {
    // Predicted before it was written, and the prediction was wrong in the
    // useful direction: moving the panel back to the left **in the stylesheet
    // alone** reddens nothing above, because the side is markup order rather
    // than a property. Two properties could do it from the sheet without
    // touching the markup, so both are closed here: `order` on the panel, and a
    // reversed `flex-direction` on the row it sits in.
    expect(valuesReaching(rules, element('sidebar'), 'order')).toEqual([]);
    const direction = valuesReaching(rules, element('main-area'), 'flex-direction');
    expect(direction.every((value) => !value.includes('reverse'))).toBe(true);
  });

  it('is bordered on every side, rounded, shadowed, and clear of the window edges', () => {
    const panel = element('sidebar');
    expect(declared(panel, 'border')).toBe('1px solid var(--border)');
    expect(declared(panel, 'border-radius')).toBe('8px');
    // Top, right and bottom clear the frame; the left edge sits against the
    // editor, which keeps 40px of padding of its own.
    expect(declared(panel, 'margin')).toBe('8px 8px 8px 0');
    expect(declared(panel, 'box-shadow')).toBe('0 2px 8px var(--shadow-md)');
    // The rounded corners have to clip the square tree inside them.
    expect(declared(panel, 'overflow')).toBe('hidden');
    // The single edge it carried while it was on the left is gone with the side.
    expect(declared(panel, 'border-right')).toBeUndefined();
  });

  it('draws its edge with the token that is at 3 to 1, not with its fill', () => {
    // Measured in all seven palettes: `--surface` against `--bg` is 1.05 to
    // 1.15, so the fill is no edge on its own, while `--border` is 3.05 to 3.09
    // against the surface it encloses since #340. The numbers are on the issue;
    // what is here is that the edge is that token.
    expect(declared(element('sidebar'), 'border')).toContain('var(--border)');
    expect(declared(element('sidebar'), 'background')).toBe('var(--surface)');
  });

  it('takes its own room rather than covering the document', () => {
    // The owner decision of 2026-09-17, and the mechanism that carries it: the
    // panel is an ordinary item of the flex row, so the editor stack beside it
    // is narrowed rather than overlaid. A panel that floated would say
    // `position: absolute` or `fixed` here. How narrow the editor becomes was
    // measured in Chromium — 372px at the 600x400 minimum — and is on the issue.
    const panel = element('sidebar');
    const position = declared(panel, 'position');
    expect(position === undefined || position === 'static').toBe(true);
    expect(declared(panel, 'flex-shrink')).toBe('0');
    expect(declared(panel, 'width')).toBe('220px');
  });

  it('holds one thing in its header, the close cross having gone with the side', () => {
    // On the right the cross landed 26px under the control that opens and
    // closes the panel — two doors to one room, measured in Chromium. The
    // control is the door now.
    const header = element('sidebar-header');
    expect(header.querySelectorAll('button')).toHaveLength(0);
    expect(header.textContent?.trim()).toBe('Files');
    expect(document.getElementById('sidebar-close')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The menu, one section and one entry fewer
// ─────────────────────────────────────────────────────────────────────────────

describe('the View section left with its one entry', () => {
  it('leaves five sections, and none of them is View', () => {
    const headers = Array.from(
      document.querySelectorAll<HTMLElement>('#menu-dropdown .menu-section'),
    );
    expect(headers.map((header) => header.textContent?.replace('›', '').trim())).toEqual([
      'File',
      'Edit',
      'Insert',
      'Table',
      'Help',
    ]);
  });

  it('leaves no entry behind it, which would be a door onto nothing', () => {
    // The two halves fail differently and both are covered. A section kept with
    // its binding removed leaves an entry that does nothing, and the row in
    // `menu.test.ts` that matches every rendered entry against a handler is
    // what sees it. A binding kept with its section removed throws out of
    // `required` at boot, which reddens every row that opens the menu.
    expect(document.getElementById('menu-toggle-sidebar')).toBeNull();
    expect(document.getElementById('menu-panel-view')).toBeNull();
    expect(document.getElementById('menu-section-view')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The panel keeps the tree it always had
// ─────────────────────────────────────────────────────────────────────────────

describe('the tree is the tree, on whichever side the panel sits', () => {
  it('indents rightwards and roots the same line', () => {
    // Neither carries a side: a tree indents away from its names wherever its
    // panel is, and every editor whose panel can be moved keeps it that way.
    // Asserted so that a future head does not mirror them by reflex.
    const sidebar = setupSidebar();
    sidebar.showTree(
      [
        {
          name: 'docs',
          path: 'docs',
          kind: 'directory',
          children: [{ name: 'guide.md', path: 'docs/guide.md', kind: 'file', children: [] }],
        },
      ],
      'project',
      '/project',
      true,
    );
    const children = document.querySelector('.sidebar-tree-children') as HTMLElement;
    expect(declared(children, 'padding-left')).toBe('16px');
    expect(declared(children, 'padding-right')).toBeUndefined();
    const root = document.querySelector('.sidebar-root') as HTMLElement;
    expect(root.textContent).toContain('project');
    expect(declared(root, 'padding')).toBe('4px 12px');
  });

  it('still opens a document from an entry, with the panel on the right', () => {
    const sidebar = setupSidebar();
    const opened = vi.fn();
    sidebar.setOnFileClick(opened);
    sidebar.showTree(
      [{ name: 'notes.md', path: 'notes.md', kind: 'file', children: [] }],
      'project',
      '/project',
      true,
    );
    (document.querySelector('.sidebar-file-entry') as HTMLElement).click();
    expect(opened).toHaveBeenCalledWith('/project/notes.md', '/project');
  });
});
