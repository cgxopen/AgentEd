import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The shipped page, so a menu entry deleted from the real markup fails here
// rather than at the user's first click (setupMenu asserts every id exists).
import shippedPage from '../../index.html?raw';
import { insertMenuCallbacks } from '../editor/insert-blocks';
import { createEditor, type EditorInstance } from '../editor/setup';
import stylesCss from '../styles.css?raw';
import {
  reaches,
  valuesReaching as rulesReaching,
  type StyleRule,
  splitTopLevel,
  stylesheetRules,
} from '../test-support/stylesheet-rules';
import { type MenuCallbacks, setupMenu } from './menu';

/**
 * Undo and Redo enabled. The rows below click every entry the menu ships, and a
 * greyed entry cannot be chosen; when the two are greyed is asserted in
 * `editor/history-routes.test.ts`, over a real editor.
 */
const bothAvailable = () => ({ canUndo: true, canRedo: true });

/**
 * Every entry the reading can grey, enabled. The rows that click an entry need
 * it choosable, and a greyed entry cannot be chosen; **when each is greyed is
 * asserted over a real editor in `editor/table-shape.test.ts` for the seven
 * Table entries and in `editor/image-description.test.ts` for the eighth entry
 * of Edit**. What is asserted here is that the reading reaches the entries at
 * all, and the order in which it is read (#292, #291, #307).
 */
const everyEntryOffered = () => ({
  imageDescription: true,
  addRowAbove: true,
  addRowBelow: true,
  deleteRow: true,
  addColumnBefore: true,
  addColumnAfter: true,
  deleteColumn: true,
  deleteTable: true,
});

function callbacks(): MenuCallbacks {
  return {
    onNew: vi.fn(),
    onNewFromTemplate: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onClose: vi.fn(),
    onFind: vi.fn(),
    onReplace: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSelectAll: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertChecklist: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onInsertMetadata: vi.fn(),
    onInsertEmoji: vi.fn(),
    onImageDescription: vi.fn(),
    onToggleSpellcheck: vi.fn(),
    onAddRowAbove: vi.fn(),
    onAddRowBelow: vi.fn(),
    onDeleteRow: vi.fn(),
    onAddColumnBefore: vi.fn(),
    onAddColumnAfter: vi.fn(),
    onDeleteColumn: vi.fn(),
    onDeleteTable: vi.fn(),
    onAbout: vi.fn(),
  };
}

/**
 * The page's `<header>`, which holds the hamburger and its dropdown. Only that
 * fragment: mounting the whole document would send happy-dom fetching the
 * stylesheet and the icons.
 */
function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

beforeEach(() => {
  // innerHTML does not execute scripts, so this is just the markup — the same
  // elements main.ts binds at boot.
  document.body.innerHTML = shippedHeaderMarkup();
});

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped header has no #${id}`);
  return found;
}

/** Whether nothing above the element, itself included, is hidden by the menu. */
function isShown(target: Element): boolean {
  return target.closest('[hidden], .hidden') === null;
}

describe('setupMenu', () => {
  it('binds every entry the hamburger menu ships', () => {
    expect(() => setupMenu(callbacks(), bothAvailable, everyEntryOffered)).not.toThrow();
  });

  it('opens About from the Help entry', () => {
    const handlers = callbacks();
    setupMenu(handlers, bothAvailable, everyEntryOffered);

    element('menu-about').click();

    expect(handlers.onAbout).toHaveBeenCalledTimes(1);
  });

  it('closes the menu when About is chosen', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    const dropdown = element('menu-dropdown');

    element('menu-toggle').click();
    expect(dropdown.classList.contains('hidden')).toBe(false);

    element('menu-about').click();
    expect(dropdown.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every entry runs its own command (#294)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every entry the menu ships, in the order a person sees it: the panel that
 * holds it, the words on it, its id, and the one handler choosing it must run.
 *
 * **This table is the specification, and restating it here is the point.**
 * Measured before #294: swapping the handlers of Find Next and Find Previous in
 * `menu.ts` turned 0 of 3075 tests red, because apart from four entries nothing
 * said which handler an entry calls. A menu where everything is reachable and
 * two entries are wired to each other is the #204 shape, and this is what now
 * stands against it for every entry the page renders, which the first row
 * below counts.
 *
 * The rows click the entry the shipped `index.html` renders, reached the way a
 * person reaches it — the toggle, then the section, then the entry — through
 * the real `setupMenu`, and never the mapping object. The words are read too,
 * so an id moved onto the wrong label reddens as well as a handler moved onto
 * the wrong id.
 *
 * **Not covered, stated rather than implied**: which command `main.ts` hands to
 * each key. It cannot be imported without booting the application. The commands
 * with their own tests are reached through the objects `main.ts` spreads —
 * `insertMenuCallbacks`, `tableMenuCallbacks` and `codeBlockRoutes` — and the
 * rest are one line each in `main.ts`.
 */
const ENTRIES: ReadonlyArray<
  readonly [panel: string, label: string, id: string, handler: keyof MenuCallbacks]
> = [
  ['menu-panel-file', 'New', 'menu-new', 'onNew'],
  ['menu-panel-file', 'New from Template…', 'menu-new-from-template', 'onNewFromTemplate'],
  ['menu-panel-file', 'Open', 'menu-open', 'onOpen'],
  ['menu-panel-file', 'Save', 'menu-save', 'onSave'],
  ['menu-panel-file', 'Save As', 'menu-save-as', 'onSaveAs'],
  ['menu-panel-file', 'Close file', 'menu-close', 'onClose'],
  ['menu-panel-edit', 'Find', 'menu-find', 'onFind'],
  ['menu-panel-edit', 'Replace', 'menu-replace', 'onReplace'],
  ['menu-panel-edit', 'Find Next', 'menu-find-next', 'onFindNext'],
  ['menu-panel-edit', 'Find Previous', 'menu-find-prev', 'onFindPrevious'],
  ['menu-panel-edit', 'Undo', 'menu-undo', 'onUndo'],
  ['menu-panel-edit', 'Redo', 'menu-redo', 'onRedo'],
  ['menu-panel-edit', 'Select All', 'menu-select-all', 'onSelectAll'],
  ['menu-panel-edit', 'Image description', 'menu-image-description', 'onImageDescription'],
  ['menu-panel-edit', 'Spell check', 'menu-spellcheck', 'onToggleSpellcheck'],
  ['menu-panel-insert', 'Insert Table', 'menu-insert-table', 'onInsertTable'],
  ['menu-panel-insert', 'Insert Media', 'menu-insert-media', 'onInsertMedia'],
  ['menu-panel-insert', 'Insert Code Block', 'menu-insert-code-block', 'onInsertCodeBlock'],
  ['menu-panel-insert', 'Insert Checklist', 'menu-insert-checklist', 'onInsertChecklist'],
  [
    'menu-panel-insert',
    'Insert Horizontal Rule',
    'menu-insert-horizontal-rule',
    'onInsertHorizontalRule',
  ],
  ['menu-panel-insert', 'Insert Metadata', 'menu-insert-metadata', 'onInsertMetadata'],
  ['menu-panel-insert', 'Insert Emoji', 'menu-insert-emoji', 'onInsertEmoji'],
  ['menu-panel-table', 'Add Row Above', 'menu-table-add-row-above', 'onAddRowAbove'],
  ['menu-panel-table', 'Add Row Below', 'menu-table-add-row-below', 'onAddRowBelow'],
  ['menu-panel-table', 'Delete Row', 'menu-table-delete-row', 'onDeleteRow'],
  ['menu-panel-table', 'Add Column Before', 'menu-table-add-column-before', 'onAddColumnBefore'],
  ['menu-panel-table', 'Add Column After', 'menu-table-add-column-after', 'onAddColumnAfter'],
  ['menu-panel-table', 'Delete Column', 'menu-table-delete-column', 'onDeleteColumn'],
  ['menu-panel-table', 'Delete Table', 'menu-table-delete-table', 'onDeleteTable'],
  ['menu-panel-help', 'About AgentEd', 'menu-about', 'onAbout'],
];

/** The words on an entry, without the keyboard shortcut printed beside them. */
function labelOf(entry: Element): string {
  const copy = entry.cloneNode(true) as Element;
  for (const shortcut of copy.querySelectorAll('.menu-shortcut')) shortcut.remove();
  return (copy.textContent ?? '').trim();
}

/** The header that opens and folds a section panel. */
function sectionHeader(panel: string): HTMLElement {
  const header = document.querySelector<HTMLElement>(
    `#menu-dropdown .menu-section[aria-controls="${panel}"]`,
  );
  if (!header) throw new Error(`the menu has no header for #${panel}`);
  return header;
}

/** Opens the menu and then one section, by clicking what a person clicks. */
function openSection(panel: string): void {
  element('menu-toggle').click();
  const header = sectionHeader(panel);
  expect(isShown(header), `the header of #${panel} is on screen`).toBe(true);
  header.click();
}

/** The entries the page renders inside the section panels, in page order. */
function renderedEntries(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#menu-dropdown .menu-panel button'));
}

describe('every entry runs its own command, reached the way a person reaches it (#294)', () => {
  it('has a row for every entry the page renders, and a row for every handler', () => {
    expect(renderedEntries().map((entry) => entry.id)).toEqual(ENTRIES.map(([, , id]) => id));
    expect(ENTRIES.map(([, , , handler]) => handler).sort()).toEqual(
      Object.keys(callbacks()).sort(),
    );
  });

  it.each(
    ENTRIES,
  )('%s holds %s, and choosing it runs its handler and no other', (panel, label, id, handler) => {
    const handlers = callbacks();
    setupMenu(handlers, bothAvailable, everyEntryOffered);

    openSection(panel);
    const entry = element(id);
    expect(element(panel).contains(entry)).toBe(true);
    expect(labelOf(entry)).toBe(label);
    expect(isShown(entry)).toBe(true);

    entry.click();

    for (const [name, spy] of Object.entries(handlers)) {
      expect(spy, name).toHaveBeenCalledTimes(name === handler ? 1 : 0);
    }
    // Every entry closes the menu before its command, except spell check, which
    // leaves it open so its new state is seen (#360, owner decision).
    expect(isShown(element('menu-dropdown'))).toBe(id === 'menu-spellcheck');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The accordion: the headers stay, and one section opens below its own (#294)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All of this is structure, focus and attributes, which happy-dom can see.
 * What it cannot see is layout and time — how tall each state is, whether the
 * menu scrolls, the slide itself — and a key pressed on a focused button: Enter
 * and Space on a header work because it is a native `<button>`. Those were
 * checked in Chromium and belong to the manual pass, and nothing below claims
 * them.
 *
 * The drill-down this shape replaced had a test for its back entry. It is gone
 * with the back entry, and it is named here because on the comparison build it
 * went on passing against the accordion for the wrong reason: happy-dom does not
 * apply the stylesheet that hid the back entry there.
 */

const SECTION_PANELS = [
  'menu-panel-file',
  'menu-panel-edit',
  'menu-panel-insert',
  'menu-panel-table',
  'menu-panel-help',
];

/** The section panels that are open. */
function shownPanels(): string[] {
  return Array.from(document.querySelectorAll('#menu-dropdown .menu-panel'))
    .filter((panel) => isShown(panel))
    .map((panel) => panel.id);
}

/** The panels whose headers say they are open. */
function expandedHeaders(): string[] {
  return Array.from(document.querySelectorAll('#menu-dropdown .menu-section'))
    .filter((header) => header.getAttribute('aria-expanded') === 'true')
    .map((header) => header.getAttribute('aria-controls') as string);
}

function pressEscape(): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('the menu is an accordion (#294)', () => {
  it('opens with every section folded, and each header directly above its own panel', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);

    element('menu-toggle').click();

    expect(element('menu-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(shownPanels()).toEqual([]);
    expect(expandedHeaders()).toEqual([]);
    const headers = Array.from(document.querySelectorAll('#menu-dropdown .menu-section'));
    expect(headers.map((header) => header.getAttribute('aria-controls'))).toEqual(SECTION_PANELS);
    // The names alone since #362: the arrow is a drawing, not a character.
    expect(headers.map(labelOf)).toEqual(['File', 'Edit', 'Insert', 'Table', 'Help']);
    // The order of the markup is the order of the keyboard. Measured on the
    // comparison build, where the panels followed all the headers: Tab from
    // File visited Edit, Insert, Table and Help before the entries of the open
    // section.
    expect(Array.from(element('menu-dropdown').children, (child) => child.id)).toEqual(
      SECTION_PANELS.flatMap((panel) => [sectionHeader(panel).id, panel]),
    );
  });

  it('opens each section below its own header, the headers staying, with focus on its first entry', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);

    for (const panel of SECTION_PANELS) {
      openSection(panel);

      expect(shownPanels()).toEqual([panel]);
      expect(expandedHeaders()).toEqual([panel]);
      for (const other of SECTION_PANELS) expect(isShown(sectionHeader(other)), other).toBe(true);
      expect(document.activeElement).toBe(
        renderedEntries().find((e) => element(panel).contains(e)),
      );

      pressEscape();
    }
  });

  it('moves focus past a first entry that cannot be chosen', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    (element('menu-new') as HTMLButtonElement).disabled = true;

    openSection('menu-panel-file');

    expect(document.activeElement).toBe(element('menu-new-from-template'));
  });

  it('folds an open section when its header is pressed again', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);

    for (const panel of SECTION_PANELS) {
      openSection(panel);

      sectionHeader(panel).click();

      expect(shownPanels(), panel).toEqual([]);
      expect(expandedHeaders(), panel).toEqual([]);
      expect(isShown(element('menu-dropdown')), panel).toBe(true);

      element('menu-toggle').click();
    }
  });

  it('keeps one section open at a time, folding the open one when another opens', () => {
    // Several open at once was measured and not offered: with the planned
    // contents it scrolls 125 to 213 px even at 1024x768, where one fits.
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    element('menu-toggle').click();

    for (const panel of [...SECTION_PANELS, SECTION_PANELS[0]]) {
      sectionHeader(panel).click();

      expect(shownPanels(), panel).toEqual([panel]);
      expect(expandedHeaders(), panel).toEqual([panel]);
    }
  });

  it('reopens with every section folded however it was closed', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    const closers: ReadonlyArray<readonly [string, () => void]> = [
      ['a click outside', () => document.body.click()],
      ['the toggle', () => element('menu-toggle').click()],
      ['Escape', pressEscape],
      ['a chosen entry', () => element('menu-find').click()],
    ];

    for (const [how, closeIt] of closers) {
      openSection('menu-panel-edit');
      closeIt();
      expect(isShown(element('menu-dropdown')), how).toBe(false);
      expect(element('menu-toggle').getAttribute('aria-expanded'), how).toBe('false');

      element('menu-toggle').click();

      expect(shownPanels(), how).toEqual([]);
      expect(expandedHeaders(), how).toEqual([]);
      element('menu-toggle').click();
    }
  });

  it('closes the whole menu on Escape from inside a section, with focus on the toggle', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    openSection('menu-panel-insert');
    expect(element('menu-panel-insert').contains(document.activeElement)).toBe(true);

    pressEscape();

    expect(isShown(element('menu-dropdown'))).toBe(false);
    expect(element('menu-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(element('menu-toggle'));
  });

  it('leaves focus where it is when Escape closes a menu that focus had already left', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    openSection('menu-panel-insert');
    elsewhere.focus();

    pressEscape();

    expect(isShown(element('menu-dropdown'))).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('moves focus to the toggle when a chosen entry hides the menu, instead of leaving it on the hidden entry', () => {
    // Measured before #294 in Chromium: after an entry was chosen, focus stayed
    // on it while nobody could see it, and the next Tab started from there.
    const handlers = callbacks();
    setupMenu(handlers, bothAvailable, everyEntryOffered);
    // Help, which is the section holding one entry since #347 moved the one
    // entry of View onto a header control and View went with it.
    openSection('menu-panel-help');
    element('menu-about').focus();

    element('menu-about').click();

    expect(handlers.onAbout).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(element('menu-toggle'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The height of the open menu (#273, #294)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nothing in this suite can see how tall the menu is: happy-dom performs no
 * layout, and every rectangle it reports is zero. What the repair for #273 does
 * on screen, and what #294 does to each panel, is verified by hand at the
 * minimum window and at 125 and 150 per cent display scaling.
 *
 * What can be asserted, and is, is the rule itself: read out of the shipped
 * stylesheet, its selector run against the `#menu-dropdown` the shipped page
 * renders, and its value checked for the property the repair rests on. That
 * property is that the cap takes the header height from the header, through
 * `100%` of the box the menu hangs from. A cap written as the header height at
 * one scaling, such as `calc(100vh - 44px)`, would look right on this machine
 * and be wrong on a display at 150 per cent, and this is where it fails instead.
 */

const shippedRules = stylesheetRules(stylesCss);

/** `valuesReaching` over the shipped stylesheet. */
function valuesReaching(target: Element, property: string): string[] {
  return rulesReaching(shippedRules, target, property);
}

/**
 * The terms of a `calc()` that only adds and subtracts lengths, each with its
 * sign, such as `['+100vh', '-100%', '-8px']` — or null for any other value.
 */
function calcTerms(value: string): string[] | null {
  const inner = /^calc\((.*)\)$/.exec(value.trim())?.[1];
  if (inner === undefined) return null;
  const parts = inner.trim().split(/\s+([+-])\s+/);
  const terms = [`+${parts[0]}`];
  for (let i = 1; i < parts.length; i += 2) terms.push(`${parts[i]}${parts[i + 1]}`);
  return terms.every((term) => /^[+-]\d+(\.\d+)?(vh|%|px)$/.test(term)) ? terms : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The Table entries are greyed from a reading taken when the menu opens (#292)
// ─────────────────────────────────────────────────────────────────────────────

/** The ids of the seven Table entries, in page order. */
const TABLE_ENTRY_IDS = ENTRIES.filter(([panel]) => panel === 'menu-panel-table').map(
  ([, , id]) => id,
);

/** The Table entries that are greyed, in page order. */
function greyedTableEntries(): string[] {
  return TABLE_ENTRY_IDS.filter((id) => (element(id) as HTMLButtonElement).disabled);
}

/** A caret in the header row of a GFM table: the two refused entries (#292, h1). */
const inAHeaderRow = () => ({
  ...everyEntryOffered(),
  addRowAbove: false,
  deleteRow: false,
});

/** Whether the image description entry can be chosen. */
function imageEntryGreyed(): boolean {
  return (element('menu-image-description') as HTMLButtonElement).disabled;
}

describe('the Table entries are greyed from where the caret is (#292)', () => {
  it('greys every entry whose key the reading refuses, and no other', () => {
    setupMenu(callbacks(), bothAvailable, inAHeaderRow);

    element('menu-toggle').click();

    expect(greyedTableEntries()).toEqual(['menu-table-add-row-above', 'menu-table-delete-row']);
  });

  it('greys all seven when the reading carries no key at all, which is a caret outside a table', () => {
    setupMenu(callbacks(), bothAvailable, () => ({}));

    element('menu-toggle').click();

    expect(greyedTableEntries()).toEqual(TABLE_ENTRY_IDS);
  });

  it('takes the reading at every opening rather than once at boot', () => {
    let availability = everyEntryOffered();
    setupMenu(callbacks(), bothAvailable, () => availability);

    element('menu-toggle').click();
    expect(greyedTableEntries()).toEqual([]);

    pressEscape();
    availability = inAHeaderRow();
    element('menu-toggle').click();

    expect(greyedTableEntries()).toEqual(['menu-table-add-row-above', 'menu-table-delete-row']);
  });

  /**
   * The eighth entry of Edit is greyed from the same reading, and it is the
   * only entry outside the Table section that is (#291). Over a real editor
   * and a real image, when it is greyed is `image-description.test.ts`.
   */
  it('greys the image description entry when no image is selected, and offers it when one is', () => {
    let availability: Record<string, boolean> = { ...everyEntryOffered(), imageDescription: false };
    setupMenu(callbacks(), bothAvailable, () => availability);

    element('menu-toggle').click();
    expect(imageEntryGreyed()).toBe(true);
    expect(greyedTableEntries()).toEqual([]);

    pressEscape();
    availability = everyEntryOffered();
    element('menu-toggle').click();

    expect(imageEntryGreyed()).toBe(false);
  });

  /**
   * **The witness the refresh order has never had** (#307, recorded in STATUS
   * section 4). Reading the greyed state is the first line of `open()`, so it
   * runs before a header moves focus to the first entry that can be chosen —
   * and until this section existed nothing could see it: Undo and Redo are the
   * fifth and sixth entries of Edit, and Find is enabled whichever way they are
   * greyed, so the two orders gave the same focus.
   *
   * **Add Row Above is the first entry of the Table section and is greyed with
   * the caret in a header row.** So this row reddens if the reading moves after
   * the unfold: focus would land on the entry the *previous* reading left
   * enabled, which on the first opening is Add Row Above, since the shipped
   * markup greys nothing.
   */
  it('greys the first entry of a section before a header chooses where focus lands', () => {
    setupMenu(callbacks(), bothAvailable, inAHeaderRow);

    openSection('menu-panel-table');

    expect((element('menu-table-add-row-above') as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(element('menu-table-add-row-below'));
  });

  /**
   * Outside a table every entry of the section is greyed, so the header opens a
   * panel with nothing to choose. **What happens to focus in a browser is not
   * this**: a real click focuses the header itself, which happy-dom does not
   * do, so what is asserted here is only that no entry takes focus. The look of
   * seven greyed entries belongs to the manual pass.
   */
  it('leaves focus on no entry when the whole section is greyed', () => {
    setupMenu(callbacks(), bothAvailable, () => ({}));

    openSection('menu-panel-table');

    expect(shownPanels()).toEqual(['menu-panel-table']);
    expect(renderedEntries().some((entry) => entry === document.activeElement)).toBe(false);
  });
});

describe('the open menu is bounded by the room below the header (#273)', () => {
  function openMenu(): HTMLElement {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    element('menu-toggle').click();
    const dropdown = element('menu-dropdown');
    expect(dropdown.classList.contains('hidden')).toBe(false);
    return dropdown;
  }

  it('reaches the rendered menu with one height cap at any window width, and scrolls inside it', () => {
    const dropdown = openMenu();
    expect(valuesReaching(dropdown, 'max-height')).toHaveLength(1);
    expect(valuesReaching(dropdown, 'overflow-y')).toEqual(['auto']);
  });

  it('takes the header height from the header rather than naming it, in whatever order the terms are written', () => {
    const [cap] = valuesReaching(openMenu(), 'max-height');
    // The window height, less `100%` of the #menubar padding box the menu hangs
    // from, less a small gap to the window edge, and nothing else. The order of
    // the two subtractions is not the property, so it is not asserted.
    const terms = calcTerms(cap ?? '');
    expect(terms, `max-height is ${cap}`).not.toBeNull();
    const gaps = (terms ?? []).filter((term) => term !== '+100vh' && term !== '-100%');
    expect(terms, `max-height is ${cap}`).toEqual(expect.arrayContaining(['+100vh', '-100%']));
    expect(gaps, `max-height is ${cap}`).toHaveLength(1);
    expect(gaps[0]).toMatch(/^-\d+px$/);
    expect(Number.parseFloat(gaps[0].slice(1))).toBeLessThanOrEqual(16);
  });

  it('reads a cap whose terms come in either order, and refuses a value that is not a sum of lengths', () => {
    expect(calcTerms('calc(100vh - 8px - 100%)')).toEqual(['+100vh', '-8px', '-100%']);
    expect(calcTerms('calc(100vh - 44px)')).toEqual(['+100vh', '-44px']);
    expect(calcTerms('70vh')).toBeNull();
  });
});

describe('the cap reads the header because the header is what the menu hangs from (#294)', () => {
  /** Every position the element is given, by the stylesheet at any width and by its own style. */
  function positions(target: HTMLElement): string[] {
    return [...valuesReaching(target, 'position'), target.style.position].filter(
      (value) => value !== '',
    );
  }

  it('has #menubar as the nearest positioned box above the menu', () => {
    // `100%` in the cap resolves against the containing block. Measured on the
    // #294 step zero: with the menu inside a positioned wrapper the cap became
    // 392 px at every header height, the menu ended at 413 of 400, and the page
    // scrolled again with no error anywhere. Only this test sees that.
    const dropdown = element('menu-dropdown');
    const menubar = element('menubar');
    expect(positions(dropdown)).toEqual(['absolute']);
    expect(valuesReaching(dropdown, 'top')).toEqual(['100%']);

    let box = dropdown.parentElement;
    for (let depth = 0; box && box !== menubar && depth < 16; depth++) {
      expect(
        positions(box).every((value) => value === 'static'),
        `<${box.tagName.toLowerCase()} class="${box.className}">`,
      ).toBe(true);
      box = box.parentElement;
    }

    expect(box).toBe(menubar);
    expect(positions(menubar)).toEqual(['relative']);
  });

  it('keeps every panel in flow and inside the one scroll region of the menu', () => {
    const dropdown = element('menu-dropdown');
    const panels = Array.from(dropdown.querySelectorAll<HTMLElement>('.menu-panel'));
    expect(panels.map((panel) => panel.id)).toEqual(SECTION_PANELS);

    for (const panel of panels) {
      expect(panel.parentElement, panel.id).toBe(dropdown);
      expect(
        positions(panel).every((value) => value === 'static'),
        panel.id,
      ).toBe(true);
      expect(valuesReaching(panel, 'max-height'), `${panel.id} max-height`).toEqual([]);
      expect(valuesReaching(panel, 'overflow-y'), `${panel.id} overflow-y`).toEqual([]);
      // `clip` folds the entries away without making the panel a scroll
      // container, so the menu keeps its one scroll region. `hidden`, `auto`
      // or `scroll` would each make a second one.
      expect(
        valuesReaching(panel, 'overflow').every((value) => value === 'clip'),
        `${panel.id} overflow`,
      ).toBe(true);
      // A height only while folded, and only nothing: an open panel is as tall
      // as its entries, and the cap on the menu is the only bound.
      panel.hidden = true;
      expect(valuesReaching(panel, 'height'), `${panel.id} folded`).toEqual(['0']);
      panel.hidden = false;
      expect(valuesReaching(panel, 'height'), `${panel.id} open`).toEqual([]);
    }
  });
});

/** Whether a rule sits inside `@media (prefers-reduced-motion: reduce)`. */
function isReducedMotion(rule: StyleRule): boolean {
  return rule.conditions.some((condition) => /prefers-reduced-motion:\s*reduce/.test(condition));
}

/** Whether a rule gives any transition, through the shorthand or a longhand. */
function givesTransition(rule: StyleRule): boolean {
  return [...rule.declarations].some(
    ([property, value]) => property.startsWith('transition') && value !== 'none',
  );
}

/**
 * One assertion for the whole sheet rather than one per element. #294 first
 * wrote it for the panels and chevrons of the menu, naming them; with the
 * other five transitions guarded (#302) the sheet-wide form passes, and it is
 * the stronger of the two. Measured by adding an unguarded transition to the
 * menu headers: this form reddened, and the named one, which only looked at
 * panels and chevrons, stayed green.
 *
 * What the named form also checked, and the sheet-wide one cannot, is that the
 * menu moves at all: a guard answers a transition, and deleting the transition
 * leaves nothing to answer. Recorded at the #303 review and paid on #297 by the
 * second test below, because the slide and the turning chevron are what the
 * owner chose by name on #294 and refined twice.
 */
describe('nothing in the stylesheet moves for someone who asked for less motion (#294, #302)', () => {
  it('answers every transition in the sheet with a later rule that repeats its selector and takes it away', () => {
    const moving = shippedRules.filter((rule) => !isReducedMotion(rule) && givesTransition(rule));
    const guards = shippedRules.filter(
      (rule) => isReducedMotion(rule) && rule.declarations.get('transition') === 'none',
    );
    // Motion exists to be guarded, or the assertion below would pass over nothing.
    expect(moving.length).toBeGreaterThan(0);

    // A guard wins by repeating the selector that gives the transition, later in
    // the sheet and so at the same specificity, which is why no specificity has
    // to be worked out here. Every selector of every moving rule is checked, so
    // a transition added anywhere next year reddens this until it is answered.
    const unanswered = moving.flatMap((rule) =>
      splitTopLevel(rule.selector).filter(
        (selector) =>
          !guards.some(
            (guard) =>
              shippedRules.indexOf(guard) > shippedRules.indexOf(rule) &&
              splitTopLevel(guard.selector).includes(selector),
          ),
      ),
    );
    expect(unanswered).toEqual([]);
  });

  it('keeps the slide of a menu panel and the turn of its chevron, for everyone else', () => {
    setupMenu(callbacks(), bothAvailable, everyEntryOffered);
    openSection('menu-panel-insert');
    const chevron = sectionHeader('menu-panel-insert').querySelector('.menu-chevron') as Element;
    const transitionsOn = (target: Element): string =>
      shippedRules
        .filter(
          (rule) =>
            !isReducedMotion(rule) && givesTransition(rule) && reaches(rule.selector, target),
        )
        .map((rule) => rule.declarations.get('transition') ?? '')
        .join(' | ');

    expect(transitionsOn(element('menu-panel-insert')), 'an open panel').toMatch(/\bheight\b/);
    expect(transitionsOn(element('menu-panel-file')), 'a folded panel').toMatch(/\bheight\b/);
    expect(transitionsOn(chevron), 'a chevron').toMatch(/\btransform\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two entries #266 added, driven end to end
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A checkbox and a rule are the two constructs #266 gave a visible route to,
 * and both were reachable only by typing before it. What has to be asserted is
 * not that the entries are in the markup — that is the trap this project has
 * collected ten decorative tests from, and in a menu it takes the shape of
 * asserting an entry exists rather than that pressing it did anything.
 *
 * So these click the **real rendered entry** out of the shipped page, through
 * the real `setupMenu` binding, into the **real command** imported from
 * `insert-blocks.ts` rather than restated here, and then assert **what the
 * document became**. A wrong binding — the #204 shape, a control that points at
 * one capability and runs another — is what they exist to catch; which handler
 * every entry calls is pinned for all of them by the table above.
 *
 * **The mapping is imported, not restated.** `insertMenuCallbacks` is the same
 * object `main.ts` spreads into `setupMenu`, so a swap between the two commands
 * reddens here wherever it is made. Restating the two callbacks in this file
 * was the first shape of it, and the reversal measured what that was worth:
 * pointing the rule entry at the checklist command turned zero of 2813 tests
 * red.
 *
 * **What is still not covered, stated rather than implied**: `main.ts` cannot
 * be imported without booting the application, so no test here watches it. The
 * compiler does instead — `MenuCallbacks` requires both keys, so a `main.ts`
 * that stopped supplying them would not build.
 *
 * No layout is involved in any of it, so nothing here is owed to a manual pass.
 */

let instance: EditorInstance | null = null;

/** An editor on a host of its own, alongside the header markup already mounted. */
function openEditor(markdown = ''): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  if (markdown.length > 0) instance.setMarkdown(markdown);
  return instance;
}

/**
 * The menu wired the way `main.ts` wires it: every other entry is a spy, and
 * the two under test come from `insertMenuCallbacks`, which is the same object
 * `main.ts` spreads. Restating the two callbacks here instead was measured and
 * is what the comment on that function records.
 */
function menuOverEditor(editor: EditorInstance): void {
  setupMenu(
    {
      ...callbacks(),
      ...insertMenuCallbacks(editor.editor),
    },
    bothAvailable,
    everyEntryOffered,
  );
}

function chooseEntry(id: string): void {
  document.getElementById(id)!.click();
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('the Insert entries make what they are named for', () => {
  it('makes a task list from the Checklist entry, at an empty caret', () => {
    const editor = openEditor();
    menuOverEditor(editor);
    editor.editor.commands.focus();
    expect(editor.editor.state.selection.empty).toBe(true);

    chooseEntry('menu-insert-checklist');

    expect(editor.editor.isActive('taskList')).toBe(true);
    expect(editor.editor.isActive('horizontalRule')).toBe(false);
  });

  it('makes a horizontal rule from the Horizontal Rule entry', () => {
    const editor = openEditor('a\n\nb');
    menuOverEditor(editor);
    editor.editor.commands.focus();

    chooseEntry('menu-insert-horizontal-rule');

    expect(editor.getMarkdown()).toContain('---');
    expect(editor.editor.isActive('taskList')).toBe(false);
  });

  it('leaves the document alone until an entry is pressed', () => {
    const editor = openEditor('a');
    menuOverEditor(editor);
    editor.editor.commands.focus();

    // Binding the menu is not using it. Without this the two above would pass
    // over a document that was already what they assert.
    expect(editor.getMarkdown()).toBe('a');
    expect(editor.editor.isActive('taskList')).toBe(false);
  });
});

/**
 * The round trip #266 asks for, over a construct made by the **menu route**
 * rather than by typing. The distinction is not a formality on the checklist
 * row: `markTaskLists` in the parser is what marks a **typed** list, and it is
 * load-bearing together with the widened `listItem` from #110, while a list the
 * command makes is built as a `taskList` node directly. The two reach the
 * document by different routes, and the task marker already carries recorded
 * exceptions from #157 and #165.
 *
 * Written out, read back into a second editor, written again, and compared as
 * bytes — which is the R-C2 question rather than a rendering one.
 */
function rereadThroughAFreshEditor(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const second = createEditor(host);
  try {
    second.setMarkdown(markdown);
    return second.getMarkdown();
  } finally {
    second.destroy();
    host.remove();
  }
}

describe('what the Insert entries make survives a round trip', () => {
  it('round-trips a checklist made from the menu', () => {
    const editor = openEditor();
    menuOverEditor(editor);
    editor.editor.commands.focus();

    chooseEntry('menu-insert-checklist');
    editor.editor.commands.insertContent('milk');

    const written = editor.getMarkdown();
    expect(written).toBe('- [ ] milk');
    expect(rereadThroughAFreshEditor(written)).toBe(written);
  });

  it('round-trips a checklist made from the menu and then ticked', () => {
    const editor = openEditor();
    menuOverEditor(editor);
    editor.editor.commands.focus();

    chooseEntry('menu-insert-checklist');
    editor.editor.commands.insertContent('milk');
    // The tick is a second transition on a different route: the command makes
    // an unticked item, and the checkbox is what changes the attribute.
    editor.editor.commands.updateAttributes('taskItem', { checked: true });

    const written = editor.getMarkdown();
    expect(written).toBe('- [x] milk');
    expect(rereadThroughAFreshEditor(written)).toBe(written);
  });

  it('round-trips a horizontal rule made from the menu, between two paragraphs', () => {
    const editor = openEditor('a\n\nb');
    menuOverEditor(editor);
    // The end of the first paragraph, so the rule lands between the two.
    editor.editor.commands.focus();
    editor.editor.commands.setTextSelection(3);

    chooseEntry('menu-insert-horizontal-rule');

    const written = editor.getMarkdown();
    expect(written).toBe('a\n\n---\n\nb');
    expect(rereadThroughAFreshEditor(written)).toBe(written);
  });
});
