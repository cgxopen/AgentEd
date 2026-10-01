/**
 * #390 — the menu entries print no shortcut: where an entry has a chord, the
 * chord is its tooltip, and the menu is narrower for it.
 *
 * **Said first: a tooltip on screen and the width of the menu are not
 * observable in this harness.** happy-dom draws no tooltip and lays nothing
 * out. What these rows hold is the markup the tooltip is read from, and the
 * width rule read out of the shipped stylesheet and run against the entries
 * the shipped page carries. Whether the tooltip shows, and whether the menu
 * reads right at its new width, is verified in the owner pass on the artifact.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { FOOTNOTE_SHORTCUT } from '../editor/insert-footnote';
import stylesCss from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { type MenuCallbacks, setupMenu } from './menu';

/**
 * Every entry with a chord that runs the command the entry runs, taken on the
 * #390 step zero from the handlers and not from the README: `keyboard.ts` for
 * Open, Save and Code Block, `search-manager.ts` for the four search entries,
 * and the editor keymaps for Undo, Redo and Select All.
 *
 * Two entries are left out on purpose. **Save As** has no chord: Ctrl+Shift+S
 * never reaches it, as `keyboard.ts` records. **Checklist** has one,
 * Ctrl+Shift+9 from the task list keymap, and by owner decision of 2026-09-19
 * it gets no tooltip: nothing in the interface had shown that chord, it was
 * never driven on the shipped target, and a tooltip would be the first place to
 * announce it.
 *
 * ── Written by hand, except for the last row, and why that is (#409) ──
 *
 * The project records carried this list as a debt: a chord added to a menu command reddens
 * nothing until someone adds it here, and Ctrl+Alt+F was that chord. It is
 * added — and the row **reads the chord out of the module that binds it**,
 * `FOOTNOTE_SHORTCUT`, which the extension keymap and the toolbar tooltip are
 * both built from. So for this entry a rename in one place moves all three
 * and reddens nothing falsely.
 *
 * **The other rows cannot be read that way today, and the reason is not this
 * file.** Their chords live in four places that share no table: `keyboard.ts`
 * spells Open, Save and Code Block as branches on a `KeyboardEvent`, the
 * search entries live in `search-manager.ts`, Undo, Redo and Select All come
 * from keymaps inside extensions, and the menu markup in `index.html` is
 * static. There is no mapping to read; there would have to be one first —
 * one table that both the markup and the bindings are built from — and that
 * is a change to how the menu is written rather than a change to this test.
 */
const CHORDS: ReadonlyMap<string, string> = new Map([
  ['menu-open', 'Ctrl+O'],
  ['menu-save', 'Ctrl+S'],
  ['menu-find', 'Ctrl+F'],
  ['menu-replace', 'Ctrl+H'],
  ['menu-find-next', 'F3'],
  ['menu-find-prev', 'Shift+F3'],
  ['menu-undo', 'Ctrl+Z'],
  ['menu-redo', 'Ctrl+Y'],
  ['menu-select-all', 'Ctrl+A'],
  ['menu-insert-code-block', 'Ctrl+Shift+K'],
  ['menu-insert-footnote', FOOTNOTE_SHORTCUT.chord],
]);

/** The chord as `aria-keyshortcuts` spells it, which names the Control key in full. */
function ariaSpelling(chord: string): string {
  return chord.replace(/^Ctrl\+/, 'Control+');
}

const rules = stylesheetRules(stylesCss);
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);

function shippedEntries(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('#menu-dropdown .menu-panel button')];
}

beforeEach(() => {
  document.body.innerHTML = shippedElement(shippedPage, '<header id="menubar"');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('no entry prints a shortcut (#390)', () => {
  it('has no muted text beside any entry but Spell check', () => {
    const muted = [...document.querySelectorAll('#menu-dropdown .menu-panel .menu-shortcut')]
      .filter((span) => span.parentElement?.id !== 'menu-spellcheck')
      .map((span) => [span.parentElement?.id, span.textContent]);
    expect(muted).toEqual([]);
  });

  it('keeps the Spell check state in the class the shortcuts wore', () => {
    // A state and not a chord (R-C9), so it stays beside its entry, muted by
    // the rule that muted the shortcuts (#360). What it reads, and that it
    // turns over, is held in `spellcheck-entry.test.ts`.
    const state = document.querySelector('#menu-spellcheck .menu-state');
    expect(state?.classList.contains('menu-shortcut')).toBe(true);
  });
});

describe('an entry with a chord carries it as its tooltip, and only such an entry (#390)', () => {
  it('has a census row for every chord entry the page renders', () => {
    const rendered = shippedEntries().map((entry) => entry.id);
    for (const id of CHORDS.keys()) expect(rendered, id).toContain(id);
  });

  it.each(
    shippedPage
      .match(/<button id="menu-[a-z-]+"/g)
      ?.map((tag) => tag.slice('<button id="'.length, -1))
      .filter((id) => !id.startsWith('menu-section-') && id !== 'menu-toggle') ?? [],
  )('#%s', (id) => {
    const entry = document.getElementById(id) as HTMLElement;
    const chord = CHORDS.get(id);
    if (chord === undefined) {
      expect(entry.getAttribute('title'), 'a tooltip with no chord behind it').toBeNull();
      expect(entry.hasAttribute('aria-keyshortcuts')).toBe(false);
      return;
    }
    expect(entry.getAttribute('title')).toBe(chord);
    // The same chord for a screen reader, since the tooltip is a pointer
    // affordance and the entry text no longer carries it.
    expect(entry.getAttribute('aria-keyshortcuts')).toBe(ariaSpelling(chord));
  });
});

describe('the menu keeps room past its widest entry (#390)', () => {
  it('gives every entry of a section 2em more on its right than a row has', () => {
    const entries = shippedEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(valuesReaching(atEveryWidth, entry, 'padding-right').at(-1), entry.id).toBe(
        'calc(12px + 2em)',
      );
    }
  });

  it('leaves the section headers and the Open Recent card at the row padding', () => {
    // The card is placed beside the menu with a width of its own (#381) and
    // is out of scope here; a header is not an entry.
    const handlers = new Proxy({}, { get: () => () => {} }) as MenuCallbacks;
    setupMenu(
      handlers,
      () => ({ canUndo: true, canRedo: true }),
      () => ({}),
      () => ['C:\\notes\\a.md'],
    );
    (document.getElementById('menu-toggle') as HTMLElement).click();
    (document.getElementById('menu-section-file') as HTMLElement).click();
    (document.getElementById('menu-open-recent') as HTMLElement).click();
    const cardRows = [...document.querySelectorAll('#menu-dropdown .menu-recent button')];
    expect(cardRows.length).toBeGreaterThan(0);
    const headers = [...document.querySelectorAll('#menu-dropdown .menu-section')];
    for (const row of [...cardRows, ...headers]) {
      expect(valuesReaching(atEveryWidth, row, 'padding-right')).not.toContain('calc(12px + 2em)');
    }
  });
});
